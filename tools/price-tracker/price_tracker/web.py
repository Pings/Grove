from __future__ import annotations

import os
from datetime import datetime, timezone
from pathlib import Path

from flask import Flask, flash, jsonify, redirect, render_template, request, url_for
from urllib.parse import urlparse

from . import db
from .archive import backfill_prices, wayback_calendar_url
from .notify import (
    AlertThresholds,
    DropAlert,
    GmailConfig,
    SpecialAlert,
    send_drop_alert,
    send_special_alert,
    send_test_email,
    should_alert,
    should_special_alert,
)
from .restock import clean_product_url, estimate_restock
from .scrape import scrape_product

ROOT = Path(__file__).resolve().parent.parent
TEMPLATE_DIR = ROOT / "templates"
STATIC_DIR = ROOT / "static"


def short_name(name: str, limit: int = 34) -> str:
    text = (name or "").strip()
    for prefix in ("Hill's Science Diet ", "Hills Science Diet ", "Hill's "):
        if text.startswith(prefix):
            text = text[len(prefix) :]
            break
    for sep in (" – ", " — ", " - "):
        if sep in text:
            text = text.split(sep, 1)[0].strip()
            break
    if len(text) > limit:
        return text[: limit - 1].rstrip() + "…"
    return text


def host_of(url: str) -> str:
    try:
        host = urlparse(url).netloc.lower()
    except Exception:
        return ""
    return host[4:] if host.startswith("www.") else host


def create_app(db_path: Path = db.DEFAULT_DB) -> Flask:
    app = Flask(
        __name__,
        template_folder=str(TEMPLATE_DIR),
        static_folder=str(STATIC_DIR),
    )
    app.secret_key = "covet-local-dev"
    app.config["DB_PATH"] = db_path
    app.jinja_env.filters["short_name"] = short_name
    app.jinja_env.filters["host"] = host_of

    @app.before_request
    def _ensure_db():
        conn = get_conn()
        db.init_db(conn)
        conn.close()

    def get_conn():
        return db.connect(app.config["DB_PATH"])

    def load_notify_config(conn):
        settings = db.get_settings(conn)
        gmail = GmailConfig(
            address=settings.get("gmail_address", ""),
            app_password=settings.get("gmail_app_password", ""),
            notify_to=settings.get("notify_to", ""),
        )
        thresholds = AlertThresholds(
            enabled=settings.get("notify_enabled", "0") == "1",
            drop_percent=_to_float(settings.get("drop_percent"), 5.0),
            drop_amount=_to_float(settings.get("drop_amount"), 0.0),
        )
        repeat_special = _to_float(settings.get("repeat_special_percent"), 20.0)
        default_lead = int(_to_float(settings.get("repeat_check_lead_days"), 14))
        return gmail, thresholds, repeat_special, default_lead

    def enrich_card(conn, row: dict, default_lead: int) -> dict:
        points = db.history(conn, row["id"])
        prices = [p.price for p in points]
        product = db.get_product(conn, row["id"])
        lead = (
            product.check_lead_days
            if product and product.check_lead_days is not None
            else default_lead
        )
        restock = None
        if product and product.category == "repeat":
            restock = estimate_restock(
                last_purchased_at=product.last_purchased_at,
                days_supply=product.days_supply,
                food_level_pct=product.food_level_pct,
                food_level_set_at=product.food_level_set_at,
                check_lead_days=lead,
            )
        return {
            **row,
            "category": product.category if product else row.get("category", "watch"),
            "points": [
                {
                    "t": p.observed_at,
                    "price": p.price,
                    "source": p.source,
                    "availability": p.availability,
                    "list_price": p.list_price,
                    "discount_percent": p.discount_percent,
                }
                for p in points
            ],
            "low": min(prices) if prices else None,
            "high": max(prices) if prices else None,
            "count": len(points),
            "last_purchased_at": product.last_purchased_at if product else None,
            "days_supply": product.days_supply if product else None,
            "food_level_pct": product.food_level_pct if product else None,
            "check_lead_days": lead,
            "special_threshold_pct": product.special_threshold_pct if product else None,
            "restock": {
                "empty_on": restock.empty_on.isoformat() if restock and restock.empty_on else None,
                "days_left": restock.days_left if restock else None,
                "in_check_window": restock.in_check_window if restock else True,
                "food_level_pct": restock.food_level_pct if restock else None,
                "check_lead_days": lead,
            }
            if restock
            else None,
        }

    def maybe_notify_drop(conn, product, old_price, new_price, currency):
        if old_price is None or product.category == "repeat":
            return None
        gmail, thresholds, _repeat, _lead = load_notify_config(conn)
        alert = DropAlert(
            product_name=product.name,
            product_url=product.url,
            currency=currency,
            old_price=old_price,
            new_price=new_price,
        )
        if not should_alert(alert, thresholds):
            return None
        return _send_or_skip(
            conn,
            gmail,
            product,
            old_price,
            new_price,
            currency,
            lambda: send_drop_alert(gmail, alert),
            detail=f"drop -{alert.drop_percent:.1f}%",
            ok_msg=(
                f"Alert: {short_name(product.name)} "
                f"{currency} {old_price:,.0f} → {new_price:,.0f}"
            ),
        )

    def maybe_notify_special(conn, product, scraped):
        if product.category != "repeat":
            return None
        gmail, thresholds, repeat_special, _lead = load_notify_config(conn)
        threshold = (
            product.special_threshold_pct
            if product.special_threshold_pct is not None
            else repeat_special
        )
        if not should_special_alert(
            discount_percent=scraped.discount_percent,
            threshold=threshold,
            enabled=thresholds.enabled,
        ):
            return None
        if scraped.list_price is None or scraped.discount_percent is None:
            return None
        alert = SpecialAlert(
            product_name=product.name,
            product_url=product.url,
            currency=scraped.currency or product.currency,
            price=scraped.price,
            list_price=scraped.list_price,
            discount_percent=scraped.discount_percent,
        )
        return _send_or_skip(
            conn,
            gmail,
            product,
            scraped.list_price,
            scraped.price,
            scraped.currency or product.currency,
            lambda: send_special_alert(gmail, alert),
            detail=f"special -{scraped.discount_percent:.0f}%",
            ok_msg=(
                f"Special {scraped.discount_percent:.0f}%: "
                f"{short_name(product.name)} ${scraped.price:,.2f}"
            ),
        )

    def _send_or_skip(conn, gmail, product, old_price, new_price, currency, send_fn, detail, ok_msg):
        if not gmail.configured:
            db.log_notification(
                conn,
                product_id=product.id,
                old_price=old_price,
                new_price=new_price,
                currency=currency,
                status="skipped",
                detail="Gmail not configured",
            )
            return "Alert ready — set Gmail in Settings."
        try:
            send_fn()
            db.log_notification(
                conn,
                product_id=product.id,
                old_price=old_price,
                new_price=new_price,
                currency=currency,
                status="sent",
                detail=detail,
            )
            return ok_msg
        except Exception as exc:  # noqa: BLE001
            db.log_notification(
                conn,
                product_id=product.id,
                old_price=old_price,
                new_price=new_price,
                currency=currency,
                status="error",
                detail=str(exc),
            )
            return f"Email failed: {exc}"

    def run_backfill(conn, product, months: int = 6) -> str:
        results = backfill_prices(product.url, months=months)
        if not results:
            return "No archive history."
        inserted = 0
        for observed_at, price, currency, availability in results:
            if db.add_price(
                conn,
                product_id=product.id,
                price=price,
                currency=currency or product.currency,
                observed_at=observed_at,
                source="wayback",
                availability=availability,
            ):
                inserted += 1
        return f"Archive: +{inserted}"

    def check_product(conn, product, *, force: bool = False):
        gmail, thresholds, repeat_special, default_lead = load_notify_config(conn)
        del gmail, thresholds, repeat_special
        if product.category == "repeat" and not force:
            lead = (
                product.check_lead_days
                if product.check_lead_days is not None
                else default_lead
            )
            status = estimate_restock(
                last_purchased_at=product.last_purchased_at,
                days_supply=product.days_supply,
                food_level_pct=product.food_level_pct,
                food_level_set_at=product.food_level_set_at,
                check_lead_days=lead,
            )
            if not status.in_check_window:
                left = (
                    f"{status.days_left:.0f}d left"
                    if status.days_left is not None
                    else "stocked"
                )
                return "skipped", f"{short_name(product.name)}: skip ({left})"

        previous = db.latest_price(conn, product.id)
        scraped = scrape_product(product.url)
        now = datetime.now(timezone.utc)
        db.add_price(
            conn,
            product_id=product.id,
            price=scraped.price,
            currency=scraped.currency or product.currency,
            observed_at=now,
            source="live",
            availability=scraped.availability,
            list_price=scraped.list_price,
            discount_percent=scraped.discount_percent,
        )
        if scraped.name and scraped.name != product.name:
            product = db.upsert_product(
                conn,
                name=scraped.name,
                url=product.url,
                currency=scraped.currency or product.currency,
                notes=product.notes,
                category=product.category,
            )
        notices = []
        drop = maybe_notify_drop(
            conn,
            product,
            previous.price if previous else None,
            scraped.price,
            scraped.currency or product.currency,
        )
        if drop:
            notices.append(drop)
        special = maybe_notify_special(conn, product, scraped)
        if special:
            notices.append(special)
        disc = (
            f" (−{scraped.discount_percent:.0f}%)"
            if scraped.discount_percent
            else ""
        )
        msg = (
            f"{short_name(product.name)}: "
            f"${scraped.price:,.2f}{disc}"
        )
        return "ok", msg, notices

    @app.route("/")
    def index():
        conn = get_conn()
        try:
            _gmail, _t, _rs, default_lead = load_notify_config(conn)
            watch = [
                enrich_card(conn, row, default_lead)
                for row in db.latest_prices(conn, category="watch")
            ]
            restock = [
                enrich_card(conn, row, default_lead)
                for row in db.latest_prices(conn, category="repeat")
            ]
        finally:
            conn.close()
        return render_template("index.html", watch=watch, restock=restock)

    @app.get("/settings")
    def settings_page():
        conn = get_conn()
        try:
            settings = db.get_settings(conn)
        finally:
            conn.close()
        return render_template("settings.html", settings=settings)

    @app.post("/settings")
    def save_settings():
        conn = get_conn()
        try:
            values = {
                "gmail_address": (request.form.get("gmail_address") or "").strip(),
                "gmail_app_password": (request.form.get("gmail_app_password") or "").strip(),
                "notify_to": (request.form.get("notify_to") or "").strip(),
                "notify_enabled": "1" if request.form.get("notify_enabled") else "0",
                "drop_percent": (request.form.get("drop_percent") or "5").strip(),
                "drop_amount": (request.form.get("drop_amount") or "0").strip(),
                "repeat_special_percent": (
                    request.form.get("repeat_special_percent") or "20"
                ).strip(),
                "repeat_check_lead_days": (
                    request.form.get("repeat_check_lead_days") or "14"
                ).strip(),
            }
            current = db.get_settings(conn)
            if not values["gmail_app_password"] and current.get("gmail_app_password"):
                values["gmail_app_password"] = current["gmail_app_password"]
            db.update_settings(conn, values)
            flash("Saved.", "ok")
        finally:
            conn.close()
        return redirect(url_for("settings_page"))

    @app.post("/settings/test-email")
    def test_email():
        conn = get_conn()
        try:
            gmail, *_rest = load_notify_config(conn)
            send_test_email(gmail)
            flash(f"Test sent to {gmail.recipient}.", "ok")
        except Exception as exc:  # noqa: BLE001
            flash(f"Test failed: {exc}", "error")
        finally:
            conn.close()
        return redirect(url_for("settings_page"))

    @app.post("/products")
    def add_product():
        url = clean_product_url(request.form.get("url") or "")
        category = (request.form.get("category") or "watch").strip()
        if category not in {"watch", "repeat"}:
            category = "watch"
        if not url:
            flash("URL required.", "error")
            return redirect(url_for("index"))

        conn = get_conn()
        try:
            scraped = scrape_product(url)
            name = scraped.name or url
            product = db.upsert_product(
                conn,
                name=name,
                url=url,
                currency=scraped.currency or "NZD",
                category=category,
            )
            db.add_price(
                conn,
                product_id=product.id,
                price=scraped.price,
                currency=scraped.currency or "NZD",
                observed_at=datetime.now(timezone.utc),
                source="live",
                availability=scraped.availability,
                list_price=scraped.list_price,
                discount_percent=scraped.discount_percent,
            )
            flash(
                f"Added {short_name(product.name)} · ${scraped.price:,.2f}",
                "ok",
            )
            if category == "watch":
                flash(run_backfill(conn, product, months=6), "ok")
        except Exception as exc:  # noqa: BLE001
            flash(f"Add failed: {exc}", "error")
        finally:
            conn.close()
        return redirect(url_for("index"))

    @app.post("/check")
    def check_all():
        product_id = request.form.get("id", type=int)
        force = bool(request.form.get("force"))
        conn = get_conn()
        try:
            products = db.list_products(conn)
            if product_id is not None:
                products = [p for p in products if p.id == product_id]
            if not products:
                flash("Nothing to check.", "error")
                return redirect(url_for("index"))

            ok = 0
            skipped = 0
            for product in products:
                try:
                    result = check_product(conn, product, force=force)
                    status, msg = result[0], result[1]
                    notices = result[2] if len(result) > 2 else []
                    if status == "skipped":
                        skipped += 1
                        flash(msg, "ok")
                    else:
                        ok += 1
                        flash(msg, "ok")
                        for notice in notices:
                            flash(notice, "ok" if "failed" not in notice.lower() else "error")
                except Exception as exc:  # noqa: BLE001
                    flash(f"{short_name(product.name)}: {exc}", "error")
            if ok:
                flash(f"Checked {ok}.", "ok")
            if skipped and not ok:
                flash(f"Skipped {skipped} (not near restock).", "ok")
        finally:
            conn.close()
        return redirect(url_for("index"))

    @app.post("/products/<int:product_id>/restock")
    def update_restock(product_id: int):
        conn = get_conn()
        try:
            action = (request.form.get("action") or "save").strip()
            days_supply = request.form.get("days_supply", type=float)
            food_level = request.form.get("food_level_pct", type=float)
            purchased = (request.form.get("last_purchased_at") or "").strip() or None
            lead = request.form.get("check_lead_days", type=int)
            threshold = request.form.get("special_threshold_pct", type=float)

            if action == "bought":
                product = db.update_restock(
                    conn,
                    product_id,
                    last_purchased_at=purchased,
                    days_supply=days_supply,
                    food_level_pct=food_level,
                    check_lead_days=lead,
                    special_threshold_pct=threshold,
                    mark_purchased=True,
                )
                flash(
                    f"Logged purchase: {short_name(product.name) if product else product_id}",
                    "ok",
                )
            else:
                product = db.update_restock(
                    conn,
                    product_id,
                    last_purchased_at=purchased,
                    days_supply=days_supply,
                    food_level_pct=food_level,
                    check_lead_days=lead,
                    special_threshold_pct=threshold,
                )
                flash(
                    f"Updated: {short_name(product.name) if product else product_id}",
                    "ok",
                )
        finally:
            conn.close()
        return redirect(url_for("index"))

    @app.post("/products/<int:product_id>/delete")
    def delete_product(product_id: int):
        conn = get_conn()
        try:
            product = db.get_product(conn, product_id)
            if product and db.delete_product(conn, product_id):
                flash(f"Removed {short_name(product.name)}.", "ok")
            else:
                flash("Not found.", "error")
        finally:
            conn.close()
        return redirect(url_for("index"))

    @app.get("/api/products")
    def api_products():
        conn = get_conn()
        try:
            _g, _t, _r, default_lead = load_notify_config(conn)
            out = [
                enrich_card(conn, row, default_lead) for row in db.latest_prices(conn)
            ]
            return jsonify(out)
        finally:
            conn.close()

    @app.get("/product/<int:product_id>")
    def product_detail(product_id: int):
        conn = get_conn()
        try:
            product = db.get_product(conn, product_id)
            if not product:
                flash("Not found.", "error")
                return redirect(url_for("index"))
            points = db.history(conn, product_id)
            latest = points[-1] if points else None
            _g, _t, _r, default_lead = load_notify_config(conn)
            lead = (
                product.check_lead_days
                if product.check_lead_days is not None
                else default_lead
            )
            restock = None
            if product.category == "repeat":
                restock = estimate_restock(
                    last_purchased_at=product.last_purchased_at,
                    days_supply=product.days_supply,
                    food_level_pct=product.food_level_pct,
                    food_level_set_at=product.food_level_set_at,
                    check_lead_days=lead,
                )
            return render_template(
                "product.html",
                product=product,
                points=points,
                latest=latest,
                restock=restock,
                wayback_url=wayback_calendar_url(product.url),
            )
        finally:
            conn.close()

    return app


def _to_float(value, default: float) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


class _PrefixMiddleware:
    """Set SCRIPT_NAME so url_for/redirects keep an nginx path prefix.

    Use with nginx `proxy_pass http://prices:5050/;` (prefix stripped before Flask).
    """

    def __init__(self, app, prefix: str):
        self.app = app
        self.prefix = prefix.rstrip("/") or ""

    def __call__(self, environ, start_response):
        if self.prefix:
            environ["SCRIPT_NAME"] = self.prefix
        return self.app(environ, start_response)


def main():
    db_path = Path(os.environ["PRICES_DB"]) if os.environ.get("PRICES_DB") else db.DEFAULT_DB
    prefix = os.environ.get("PRICES_URL_PREFIX", "").strip()
    app = create_app(db_path)
    if prefix:
        app.wsgi_app = _PrefixMiddleware(app.wsgi_app, prefix)  # type: ignore[method-assign]
    host = os.environ.get("PRICES_HOST", "127.0.0.1")
    port = int(os.environ.get("PRICES_PORT", "5050"))
    print(f"Covet running at http://{host}:{port}{prefix or ''}")
    app.run(host=host, port=port, debug=False, use_reloader=False)


if __name__ == "__main__":
    main()
