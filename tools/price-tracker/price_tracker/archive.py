from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Optional
from urllib.parse import quote

import requests

from .scrape import USER_AGENT, scrape_product

CDX_API = "https://web.archive.org/cdx/search/cdx"
WAYBACK_PREFIX = "https://web.archive.org/web"


def list_snapshots(
    url: str,
    *,
    months: int = 6,
    limit: int = 200,
) -> list[tuple[datetime, str]]:
    """Return (timestamp, archive_url) pairs from the Wayback CDX API."""
    end = datetime.now(timezone.utc)
    start = end - timedelta(days=30 * months)
    params = {
        "url": url,
        "output": "json",
        "fl": "timestamp,original,statuscode,mimetype",
        "filter": "statuscode:200",
        "from": start.strftime("%Y%m%d"),
        "to": end.strftime("%Y%m%d"),
        "collapse": "timestamp:8",  # roughly one snapshot per day
        "limit": str(limit),
    }
    resp = requests.get(
        CDX_API,
        params=params,
        headers={"User-Agent": USER_AGENT},
        timeout=60,
    )
    resp.raise_for_status()
    data = resp.json()
    if not data or len(data) < 2:
        return []

    snapshots = []
    for row in data[1:]:
        ts_raw, _original, _status, mimetype = row[0], row[1], row[2], row[3]
        if mimetype and "html" not in mimetype.lower():
            continue
        observed = datetime.strptime(ts_raw, "%Y%m%d%H%M%S").replace(tzinfo=timezone.utc)
        archive_url = f"{WAYBACK_PREFIX}/{ts_raw}/{url}"
        snapshots.append((observed, archive_url))
    return snapshots


def fetch_archived_html(archive_url: str) -> str:
    resp = requests.get(
        archive_url,
        headers={"User-Agent": USER_AGENT, "Accept": "text/html"},
        timeout=60,
    )
    resp.raise_for_status()
    return resp.text


def backfill_prices(
    url: str,
    *,
    months: int = 6,
    on_progress=None,
) -> list[tuple[datetime, float, str, Optional[str]]]:
    """
    Pull historical prices from Wayback Machine snapshots.

    Returns list of (observed_at, price, currency, availability).
    Raises nothing for empty archives — returns [].
    """
    snapshots = list_snapshots(url, months=months)
    if on_progress:
        on_progress(f"Found {len(snapshots)} Wayback snapshot(s) in the last {months} months")

    results = []
    for observed_at, archive_url in snapshots:
        try:
            html = fetch_archived_html(archive_url)
            scraped = scrape_product(url, html=html)
            results.append(
                (observed_at, scraped.price, scraped.currency, scraped.availability)
            )
            if on_progress:
                on_progress(
                    f"  {observed_at.date()} → {scraped.currency} {scraped.price:.2f}"
                )
        except Exception as exc:  # noqa: BLE001 — continue across bad snapshots
            if on_progress:
                on_progress(f"  {observed_at.date()} skipped ({exc})")
    return results


def wayback_calendar_url(url: str) -> str:
    return f"https://web.archive.org/web/*/{quote(url, safe=':/')}"
