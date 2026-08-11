from __future__ import annotations

import json
import re
from dataclasses import dataclass
from typing import Optional
from urllib.parse import urlparse

import requests
from bs4 import BeautifulSoup

USER_AGENT = (
    "Mozilla/5.0 (compatible; Covet/0.1; +https://github.com/Pings/Grove)"
)
TIMEOUT = 30


@dataclass
class ScrapeResult:
    name: Optional[str]
    price: float
    currency: str
    availability: Optional[str]
    raw_source: str
    list_price: Optional[float] = None
    discount_percent: Optional[float] = None


def fetch_html(url: str) -> str:
    resp = requests.get(
        url,
        headers={"User-Agent": USER_AGENT, "Accept": "text/html,application/xhtml+xml"},
        timeout=TIMEOUT,
    )
    resp.raise_for_status()
    return resp.text


def scrape_product(url: str, html: Optional[str] = None) -> ScrapeResult:
    html = html if html is not None else fetch_html(url)
    soup = BeautifulSoup(html, "html.parser")
    host = urlparse(url).netloc.lower()

    extractors = []
    if "animates.co.nz" in host:
        extractors.append(_from_animates)
    extractors.extend((_from_json_ld, _from_klaviyo, _from_og_meta, _from_dm_price))

    for extractor in extractors:
        result = extractor(soup, html, url)
        if result is not None:
            return _with_discount(result)

    raise ValueError(f"Could not extract a price from {url}")


def _with_discount(result: ScrapeResult) -> ScrapeResult:
    if (
        result.list_price
        and result.list_price > 0
        and result.price < result.list_price
        and result.discount_percent is None
    ):
        result.discount_percent = round(
            (result.list_price - result.price) / result.list_price * 100.0, 1
        )
    return result


def _from_animates(soup: BeautifulSoup, html: str, url: str) -> Optional[ScrapeResult]:
    """Animates (Magento) — capture list/base vs current, including specials."""
    name = None
    h1 = soup.select_one("h1.page-title span") or soup.find("h1")
    if h1:
        name = h1.get_text(strip=True)

    list_price = None
    meta_list = soup.find("meta", property="product:price:amount")
    if meta_list and meta_list.get("content"):
        list_price = _to_float(meta_list["content"])

    base_match = re.search(r'"basePrice"\s*:\s*"(\$[^"]+)"', html)
    if base_match:
        list_price = _parse_money(base_match.group(1)) or list_price

    list_span = soup.select_one("span.list_price")
    if list_span:
        list_price = _to_float(list_span.get_text(strip=True)) or list_price

    # Prefer visible one-time final price box
    price = None
    final_node = soup.select_one('[data-price-type="finalPrice"]')
    if final_node and final_node.get("data-price-amount"):
        price = _to_float(final_node["data-price-amount"])

    final_match = re.search(r'"finalPrice"\s*:\s*"(\$[^"]+)"', html)
    # Magento config often has multiple finalPrice blocks; use JSON-LD for live shelf price
    json_ld = _from_json_ld(soup, html, url)
    if json_ld:
        price = json_ld.price
        name = name or json_ld.name
        avail = json_ld.availability
    else:
        avail = None
        if price is None and final_match:
            price = _parse_money(final_match.group(1))

    if price is None:
        return None

    # True specials: hasSpecialPrice non-empty, or special-price DOM
    has_special = bool(
        re.search(r'"hasSpecialPrice"\s*:\s*"(?!")[^"]+"', html)
        or soup.select_one(".special-price")
    )
    discount = None
    if list_price and list_price > price:
        discount = round((list_price - price) / list_price * 100.0, 1)
        # Frequent Feeder alone often ~15%; still report the math
        if not has_special and discount < 5:
            discount = None

    return ScrapeResult(
        name=name,
        price=price,
        currency="NZD",
        availability=avail,
        raw_source="animates",
        list_price=list_price,
        discount_percent=discount,
    )


def _from_json_ld(soup: BeautifulSoup, html: str, url: str) -> Optional[ScrapeResult]:
    for tag in soup.find_all("script", type="application/ld+json"):
        text = tag.string or tag.get_text() or ""
        try:
            data = json.loads(text)
        except json.JSONDecodeError:
            continue
        product = _find_product_node(data)
        if not product:
            continue
        offer = product.get("offers")
        if isinstance(offer, list):
            offer = offer[0] if offer else None
        if not isinstance(offer, dict):
            continue
        price = _to_float(offer.get("price"))
        if price is None:
            continue
        currency = (
            offer.get("priceCurrency")
            or product.get("priceCurrency")
            or _guess_currency(url)
        )
        avail = offer.get("availability")
        if isinstance(avail, str):
            avail = avail.rsplit("/", 1)[-1]
        return ScrapeResult(
            name=product.get("name"),
            price=price,
            currency=currency,
            availability=avail,
            raw_source="json-ld",
        )
    return None


def _from_klaviyo(soup: BeautifulSoup, html: str, url: str) -> Optional[ScrapeResult]:
    match = re.search(
        r'_learnq\.push\(\["track",\s*"Viewed Product",\s*(\{.*?\})\]\)',
        html,
        re.DOTALL,
    )
    if not match:
        return None
    try:
        payload = json.loads(match.group(1))
    except json.JSONDecodeError:
        return None
    price = _to_float(payload.get("Price"))
    if price is None:
        return None
    return ScrapeResult(
        name=payload.get("ProductName"),
        price=price,
        currency=_guess_currency(url),
        availability=None,
        raw_source="klaviyo",
    )


def _from_og_meta(soup: BeautifulSoup, html: str, url: str) -> Optional[ScrapeResult]:
    amount = soup.find("meta", property="product:price:amount")
    currency_tag = soup.find("meta", property="product:price:currency")
    if not amount or not amount.get("content"):
        return None
    price = _to_float(amount["content"])
    if price is None:
        return None
    currency = (
        currency_tag["content"]
        if currency_tag and currency_tag.get("content")
        else _guess_currency(url)
    )
    title = soup.find("meta", property="og:title")
    return ScrapeResult(
        name=title["content"] if title and title.get("content") else None,
        price=price,
        currency=currency,
        availability=None,
        raw_source="open-graph",
    )


def _from_dm_price(soup: BeautifulSoup, html: str, url: str) -> Optional[ScrapeResult]:
    """Danske Mobler product page fallback."""
    node = soup.select_one("#price-container") or soup.select_one(".dm-price")
    if not node:
        return None
    price = _parse_money(node.get_text(" ", strip=True))
    if price is None:
        return None
    title = soup.find("h1")
    avail_node = soup.select_one("#availalbilityContainer") or soup.select_one(
        "#availabilityContainer"
    )
    availability = None
    if avail_node:
        availability = avail_node.get_text(" ", strip=True)
        availability = re.sub(r"^Availability:\s*", "", availability, flags=re.I)
    return ScrapeResult(
        name=title.get_text(strip=True) if title else None,
        price=price,
        currency=_guess_currency(url),
        availability=availability,
        raw_source="dm-price",
    )


def _find_product_node(data) -> Optional[dict]:
    if isinstance(data, dict):
        type_ = data.get("@type")
        types = type_ if isinstance(type_, list) else [type_]
        if any(t == "Product" for t in types if t):
            return data
        for key in ("@graph", "mainEntity", "itemListElement"):
            if key in data:
                found = _find_product_node(data[key])
                if found:
                    return found
    elif isinstance(data, list):
        for item in data:
            found = _find_product_node(item)
            if found:
                return found
    return None


def _to_float(value) -> Optional[float]:
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value)
    text = str(value).strip()
    if re.fullmatch(r"\d+(?:\.\d+)?", text.replace(",", "")):
        return float(text.replace(",", ""))
    return _parse_money(text)


def _parse_money(text: str) -> Optional[float]:
    match = re.search(
        r"(?:NZ\$|A\$|US\$|\$)?\s*"
        r"(\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+\.\d{1,2}|\d+)",
        text,
    )
    if not match:
        return None
    return float(match.group(1).replace(",", ""))


def _guess_currency(url: str) -> str:
    host = urlparse(url).netloc.lower()
    if host.endswith(".co.nz") or host.endswith(".nz"):
        return "NZD"
    if host.endswith(".com.au") or host.endswith(".au"):
        return "AUD"
    return "USD"
