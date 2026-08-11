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


def estimate_restock(
    *,
    last_purchased_at: Optional[str],
    days_supply: Optional[float],
    food_level_pct: Optional[float],
    food_level_set_at: Optional[str],
    check_lead_days: int = 14,
    today: Optional[date] = None,
) -> RestockStatus:
    """Estimate when stock runs out and whether price-checking should be active."""
    today = today or datetime.now(timezone.utc).date()
    lead = max(0, int(check_lead_days or 0))

    if days_supply is None or days_supply <= 0:
        return RestockStatus(
            empty_on=None,
            days_left=None,
            in_check_window=True,  # unknown supply → always eligible
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
        # Need a purchase or food-level date before scheduled checking
        return RestockStatus(
            empty_on=None,
            days_left=None,
            in_check_window=False,
            food_level_pct=food_level_pct,
            check_lead_days=lead,
        )

    days_left = (empty_on - today).days + (empty_on - today).seconds / 86400
    # date-only math:
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
        if k.lower() not in {"srsltid", "gclid", "fbclid", "utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"}
    ]
    return urlunsplit((parts.scheme, parts.netloc, parts.path, urlencode(keep), ""))
