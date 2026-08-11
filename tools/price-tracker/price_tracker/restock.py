from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from typing import Optional


def _as_date(value: Optional[str]) -> Optional[date]:
    if not value:
        return None
    text = value.strip()
    if not text:
        return None
    try:
        return date.fromisoformat(text[:10])
    except ValueError:
        return None


@dataclass
class RestockStatus:
    empty_on: Optional[date]
    days_left: Optional[float]
    in_check_window: bool
    food_level_pct: Optional[float]
    check_lead_days: int
    stock_on_hand: Optional[float] = None
    stock_kind: Optional[str] = None
    unit_label: Optional[str] = None
    daily_use: Optional[float] = None


def daily_use_for(stock_kind: Optional[str], *, wet_daily: float = 1.0, dry_daily_g: float = 87.0) -> Optional[float]:
    kind = (stock_kind or "").strip().lower()
    if kind == "wet":
        return float(wet_daily) if wet_daily > 0 else None
    if kind == "dry":
        return float(dry_daily_g) if dry_daily_g > 0 else None
    return None


def unit_label_for(stock_kind: Optional[str]) -> str:
    kind = (stock_kind or "").strip().lower()
    if kind == "wet":
        return "packs"
    if kind == "dry":
        return "g"
    return "units"


def estimate_restock(
    *,
    last_purchased_at: Optional[str] = None,
    days_supply: Optional[float] = None,
    food_level_pct: Optional[float] = None,
    food_level_set_at: Optional[str] = None,
    check_lead_days: int = 7,
    stock_kind: Optional[str] = None,
    stock_on_hand: Optional[float] = None,
    stock_set_at: Optional[str] = None,
    wet_daily: float = 1.0,
    dry_daily_g: float = 87.0,
    today: Optional[date] = None,
) -> RestockStatus:
    """Estimate when stock runs out and whether price-checking should be active.

    Preferred model for cat food:
      wet  — stock_on_hand = packs left, burned at wet_daily packs/day
      dry  — stock_on_hand = grams left, burned at dry_daily_g g/day
    """
    today = today or datetime.now(timezone.utc).date()
    lead = max(0, int(check_lead_days or 0))
    kind = (stock_kind or "").strip().lower() or None
    daily = daily_use_for(kind, wet_daily=wet_daily, dry_daily_g=dry_daily_g)
    label = unit_label_for(kind)

    # Inventory model (wet packs / dry grams)
    if kind in {"wet", "dry"} and daily is not None:
        if stock_on_hand is None:
            return RestockStatus(
                empty_on=None,
                days_left=None,
                in_check_window=False,
                food_level_pct=None,
                check_lead_days=lead,
                stock_on_hand=None,
                stock_kind=kind,
                unit_label=label,
                daily_use=daily,
            )

        set_on = _as_date(stock_set_at) or _as_date(last_purchased_at) or today
        elapsed = max(0, (today - set_on).days)
        remaining = max(0.0, float(stock_on_hand) - elapsed * daily)
        days_left = remaining / daily if daily > 0 else None
        empty_on = today + timedelta(days=days_left) if days_left is not None else None
        in_window = days_left is not None and days_left <= lead
        # Map remaining → rough % vs amount logged at set time
        start = max(float(stock_on_hand), remaining, 1e-6)
        level_pct = round(100.0 * remaining / start, 1)
        return RestockStatus(
            empty_on=empty_on,
            days_left=round(days_left, 1) if days_left is not None else None,
            in_check_window=in_window,
            food_level_pct=level_pct,
            check_lead_days=lead,
            stock_on_hand=round(remaining, 1),
            stock_kind=kind,
            unit_label=label,
            daily_use=daily,
        )

    # Legacy % / days_supply model
    if days_supply is None or days_supply <= 0:
        return RestockStatus(
            empty_on=None,
            days_left=None,
            in_check_window=True,
            food_level_pct=food_level_pct,
            check_lead_days=lead,
        )

    level_date = _as_date(food_level_set_at) or _as_date(last_purchased_at)
    purchased = _as_date(last_purchased_at)

    if food_level_pct is not None and level_date is not None:
        level = max(0.0, min(100.0, float(food_level_pct)))
        remaining_at_set = days_supply * (level / 100.0)
        empty_on = level_date + timedelta(days=remaining_at_set)
        current_level = max(
            0.0,
            level - ((today - level_date).days / days_supply) * 100.0,
        )
    elif purchased is not None:
        empty_on = purchased + timedelta(days=float(days_supply))
        elapsed = (today - purchased).days
        current_level = max(0.0, 100.0 - (elapsed / days_supply) * 100.0)
    else:
        return RestockStatus(
            empty_on=None,
            days_left=None,
            in_check_window=False,
            food_level_pct=food_level_pct,
            check_lead_days=lead,
        )

    days_left = float((empty_on - today).days)
    window_start = empty_on - timedelta(days=lead)
    in_window = today >= window_start
    return RestockStatus(
        empty_on=empty_on,
        days_left=days_left,
        in_check_window=in_window,
        food_level_pct=round(current_level, 1),
        check_lead_days=lead,
    )


def clean_product_url(url: str) -> str:
    """Strip tracking query params."""
    from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

    parts = urlsplit(url.strip())
    keep = [
        (k, v)
        for k, v in parse_qsl(parts.query, keep_blank_values=True)
        if k.lower()
        not in {
            "srsltid",
            "gclid",
            "fbclid",
            "utm_source",
            "utm_medium",
            "utm_campaign",
            "utm_content",
            "utm_term",
            "frt",
        }
    ]
    return urlunsplit((parts.scheme, parts.netloc, parts.path, urlencode(keep), ""))
