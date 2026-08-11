from __future__ import annotations

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
    send_drop_alert,
    send_test_email,
    should_alert,
)
from .scrape import scrape_product

ROOT = Path(__file__).resolve().parent.parent
TEMPLATE_DIR = ROOT / "templates"
STATIC_DIR = ROOT / "static"


def short_name(name: str, limit: int = 34) -> str:
    text = (name or "").strip()
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
    app.secret_key = "price-tracker-local-dev"
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
        return gmail, thresholds

    def maybe_notify(conn, product, old_price, new_price, currency):
        if old_price is None:
            return None
        gmail, thresholds = load_notify_config(conn)
        alert = DropAlert(
            product_name=product.name,
            product_url=product.url,
            currency=currency,
            old_price=old_price,
            new_price=new_price,
        )
        if not should_alert(alert, thresholds):
            return None
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
            return "Drop found — set Gmail in Settings."
        try:
            send_drop_alert(gmail, alert)
            db.log_notification(
                conn,
                product_id=product.id,
                old_price=old_price,
                new_price=new_price,
                currency=currency,
                status="sent",
                detail=f"-{alert.drop_percent:.1f}%",
            )
            return (
                f"Alert sent: {short_name(product.name)} "
                f"{currency} {old_price:,.0f} → {new_price:,.0f}"
            )
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

    @app.route("/")
    def index():
        conn = get_conn()
        try:
            rows = db.latest_prices(conn)
            charts = []
            for row in rows:
                points = db.history(conn, row["id"])
                prices = [p.price for p in points]
                charts.append(
                    {
                        **row,
                        "points": [
                            {
                                "t": p.observed_at,
                                "price": p.price,
                                "source": p.source,
                                "availability": p.availability,
                            }
                            for p in points
                        ],
                        "low": min(prices) if prices else None,
                        "high": max(prices) if prices else None,
                        "count": len(points),
                    }
                )
        finally:
            conn.close()
        return render_template("index.html", products=charts)

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
            gmail, _thresholds = load_notify_config(conn)
            send_test_email(gmail)
            flash(f"Test sent to {gmail.recipient}.", "ok")
        except Exception as exc:  # noqa: BLE001
            flash(f"Test failed: {exc}", "error")
        finally:
            conn.close()
        return redirect(url_for("settings_page"))

    @app.post("/products")
    def add_product():
        url = (request.form.get("url") or "").strip()
        name = (request.form.get("name") or "").strip() or None
        currency = (request.form.get("currency") or "NZD").strip() or "NZD"
        notes = (request.form.get("notes") or "").strip()
        if not url:
            flash("URL required.", "error")
            return redirect(url_for("index"))

        conn = get_conn()
        try:
            try:
                scraped = scrape_product(url)
                name = name or scraped.name or url
                currency = scraped.currency or currency
                product = db.upsert_product(
                    conn, name=name, url=url, currency=currency, notes=notes
                )
                db.add_price(
                    conn,
                    product_id=product.id,
                    price=scraped.price,
                    currency=scraped.currency or currency,
                    observed_at=datetime.now(timezone.utc),
                    source="live",
                    availability=scraped.availability,
                )
                flash(
                    f"Added {short_name(product.name)} · {scraped.currency} {scraped.price:,.0f}",
                    "ok",
                )
                flash(run_backfill(conn, product, months=6), "ok")
            except Exception as exc:  # noqa: BLE001
                if name:
                    product = db.upsert_product(
                        conn, name=name, url=url, currency=currency, notes=notes
                    )
                    flash(f"Saved, scrape failed: {exc}", "error")
                    try:
                        flash(run_backfill(conn, product, months=6), "ok")
                    except Exception as back_exc:  # noqa: BLE001
                        flash(f"Archive failed: {back_exc}", "error")
                else:
                    flash(f"Add failed: {exc}", "error")
        finally:
            conn.close()
        return redirect(url_for("index"))

    @app.post("/check")
    def check_all():
        product_id = request.form.get("id", type=int)
        conn = get_conn()
        try:
            products = db.list_products(conn)
            if product_id is not None:
                products = [p for p in products if p.id == product_id]
            if not products:
                flash("Nothing to check.", "error")
                return redirect(url_for("index"))

            now = datetime.now(timezone.utc)
            ok = 0
            errors = []
            for product in products:
                try:
                    previous = db.latest_price(conn, product.id)
                    scraped = scrape_product(product.url)
                    db.add_price(
                        conn,
                        product_id=product.id,
                        price=scraped.price,
                        currency=scraped.currency or product.currency,
                        observed_at=now,
                        source="live",
                        availability=scraped.availability,
                    )
                    if scraped.name and scraped.name != product.name:
                        product = db.upsert_product(
                            conn,
                            name=scraped.name,
                            url=product.url,
                            currency=scraped.currency or product.currency,
                            notes=product.notes,
                        )
                    ok += 1
                    notice = maybe_notify(
                        conn,
                        product,
                        previous.price if previous else None,
                        scraped.price,
                        scraped.currency or product.currency,
                    )
                    if notice:
                        flash(notice, "ok" if "failed" not in notice.lower() else "error")
                except Exception as exc:  # noqa: BLE001
                    errors.append(f"{short_name(product.name)}: {exc}")
            if ok:
                flash(f"Checked {ok}.", "ok")
            for err in errors:
                flash(err, "error")
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
            rows = db.latest_prices(conn)
            out = []
            for row in rows:
                points = db.history(conn, row["id"])
                out.append(
                    {
                        **row,
                        "points": [
                            {
                                "t": p.observed_at,
                                "price": p.price,
                                "source": p.source,
                            }
                            for p in points
                        ],
                    }
                )
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
            return render_template(
                "product.html",
                product=product,
                points=points,
                latest=latest,
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
    import os

    db_path = Path(os.environ["PRICES_DB"]) if os.environ.get("PRICES_DB") else db.DEFAULT_DB
    prefix = os.environ.get("PRICES_URL_PREFIX", "").strip()
    app = create_app(db_path)
    if prefix:
        app.wsgi_app = _PrefixMiddleware(app.wsgi_app, prefix)  # type: ignore[method-assign]
    host = os.environ.get("PRICES_HOST", "127.0.0.1")
    port = int(os.environ.get("PRICES_PORT", "5050"))
    print(f"Price Tracker running at http://{host}:{port}{prefix or ''}")
    app.run(host=host, port=port, debug=False, use_reloader=False)


if __name__ == "__main__":
    main()
