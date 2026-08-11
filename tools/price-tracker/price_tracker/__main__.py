from __future__ import annotations

import argparse
import sys
from datetime import datetime, timezone
from pathlib import Path

import yaml

from . import __version__, db
from .archive import backfill_prices, wayback_calendar_url
from .report import generate_report
from .scrape import scrape_product

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_CONFIG = ROOT / "products.yaml"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="covet",
        description="Covet — track product prices and restock specials.",
    )
    parser.add_argument("--db", type=Path, default=db.DEFAULT_DB, help="SQLite database path")
    parser.add_argument("--version", action="version", version=f"%(prog)s {__version__}")
    sub = parser.add_subparsers(dest="command", required=True)

    p_sync = sub.add_parser("sync", help="Load products from products.yaml into the database")
    p_sync.add_argument("--config", type=Path, default=DEFAULT_CONFIG)

    p_add = sub.add_parser("add", help="Add a single product URL")
    p_add.add_argument("url")
    p_add.add_argument("--name", default=None)
    p_add.add_argument("--currency", default="NZD")
    p_add.add_argument("--notes", default="")

    sub.add_parser("list", help="List tracked products and latest prices")

    p_check = sub.add_parser("check", help="Scrape current prices for all (or one) products")
    p_check.add_argument("--id", type=int, default=None, help="Product id only")

    p_hist = sub.add_parser("history", help="Show price history for a product")
    p_hist.add_argument("id", type=int)
    p_hist.add_argument("--limit", type=int, default=50)

    p_back = sub.add_parser(
        "backfill",
        help="Pull up to N months of historical prices from the Wayback Machine",
    )
    p_back.add_argument("--id", type=int, default=None)
    p_back.add_argument("--months", type=int, default=6)

    p_report = sub.add_parser("report", help="Write an HTML price chart report")
    p_report.add_argument("--out", type=Path, default=None)

    p_serve = sub.add_parser("serve", help="Run the web interface")
    p_serve.add_argument("--host", default="127.0.0.1")
    p_serve.add_argument("--port", type=int, default=5050)

    args = parser.parse_args(argv)
    conn = db.connect(args.db)
    db.init_db(conn)

    if args.command == "sync":
        return cmd_sync(conn, args.config)
    if args.command == "add":
        return cmd_add(conn, args)
    if args.command == "list":
        return cmd_list(conn)
    if args.command == "check":
        return cmd_check(conn, args.id)
    if args.command == "history":
        return cmd_history(conn, args.id, args.limit)
    if args.command == "backfill":
        return cmd_backfill(conn, args.id, args.months)
    if args.command == "report":
        return cmd_report(conn, args.out)
    if args.command == "serve":
        conn.close()
        import os

        from .web import _PrefixMiddleware, create_app

        db_path = Path(os.environ["PRICES_DB"]) if os.environ.get("PRICES_DB") else args.db
        prefix = os.environ.get("PRICES_URL_PREFIX", "").strip()
        app = create_app(db_path)
        if prefix:
            app.wsgi_app = _PrefixMiddleware(app.wsgi_app, prefix)  # type: ignore[method-assign]
        print(f"Covet running at http://{args.host}:{args.port}{prefix or ''}")
        app.run(host=args.host, port=args.port, debug=False, use_reloader=False)
        return 0
    parser.error(f"Unknown command: {args.command}")
    return 2


def cmd_sync(conn, config_path: Path) -> int:
    if not config_path.exists():
        print(f"Config not found: {config_path}", file=sys.stderr)
        return 1
    data = yaml.safe_load(config_path.read_text(encoding="utf-8")) or {}
    products = data.get("products") or []
    synced = db.sync_products_from_config(conn, products)
    print(f"Synced {len(synced)} product(s) from {config_path}")
    for p in synced:
        print(f"  [{p.id}] {p.name}")
    return 0


def cmd_add(conn, args) -> int:
    name = args.name
    if not name:
        try:
            scraped = scrape_product(args.url)
            name = scraped.name or args.url
        except Exception:
            name = args.url
    product = db.upsert_product(
        conn, name=name, url=args.url, currency=args.currency, notes=args.notes
    )
    print(f"Added [{product.id}] {product.name}")
    return 0


def cmd_list(conn) -> int:
    rows = db.latest_prices(conn)
    if not rows:
        print("No products. Add some in products.yaml then run: python -m price_tracker sync")
        return 0
    for r in rows:
        price = (
            f"{r['currency']} {r['price']:,.2f}" if r["price"] is not None else "no data yet"
        )
        when = r["observed_at"] or "—"
        print(f"[{r['id']}] {r['name']}")
        print(f"     {price}  ({when})")
        print(f"     {r['url']}")
    return 0


def cmd_check(conn, product_id: int | None) -> int:
    products = db.list_products(conn)
    if product_id is not None:
        products = [p for p in products if p.id == product_id]
        if not products:
            print(f"No product with id {product_id}", file=sys.stderr)
            return 1
    if not products:
        print("No products to check. Run sync or add first.", file=sys.stderr)
        return 1

    now = datetime.now(timezone.utc)
    errors = 0
    for product in products:
        try:
            scraped = scrape_product(product.url)
            inserted = db.add_price(
                conn,
                product_id=product.id,
                price=scraped.price,
                currency=scraped.currency or product.currency,
                observed_at=now,
                source="live",
                availability=scraped.availability,
            )
            flag = "new" if inserted else "dup"
            avail = f", {scraped.availability}" if scraped.availability else ""
            print(
                f"[{product.id}] {product.name}: "
                f"{scraped.currency} {scraped.price:,.2f} "
                f"via {scraped.raw_source} ({flag}{avail})"
            )
            if scraped.name and scraped.name != product.name:
                db.upsert_product(
                    conn,
                    name=scraped.name,
                    url=product.url,
                    currency=scraped.currency or product.currency,
                    notes=product.notes,
                )
        except Exception as exc:  # noqa: BLE001
            errors += 1
            print(f"[{product.id}] {product.name}: ERROR {exc}", file=sys.stderr)
    return 1 if errors else 0


def cmd_history(conn, product_id: int, limit: int) -> int:
    product = db.get_product(conn, product_id)
    if not product:
        print(f"No product with id {product_id}", file=sys.stderr)
        return 1
    points = db.history(conn, product_id, limit=limit)
    print(f"{product.name} ({len(points)} points)")
    for p in points:
        avail = f"  {p.availability}" if p.availability else ""
        print(
            f"  {p.observed_at}  {p.currency} {p.price:,.2f}  [{p.source}]{avail}"
        )
    return 0


def cmd_backfill(conn, product_id: int | None, months: int) -> int:
    products = db.list_products(conn)
    if product_id is not None:
        products = [p for p in products if p.id == product_id]
        if not products:
            print(f"No product with id {product_id}", file=sys.stderr)
            return 1
    if not products:
        print("No products to backfill.", file=sys.stderr)
        return 1

    total_new = 0
    for product in products:
        print(f"\n[{product.id}] {product.name}")
        print(f"  Calendar: {wayback_calendar_url(product.url)}")
        results = backfill_prices(
            product.url, months=months, on_progress=lambda msg: print(msg)
        )
        if not results:
            print(
                "  No usable Wayback snapshots found. "
                "Historical prices will start from live checks going forward."
            )
            continue
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
                total_new += 1
    print(f"\nInserted {total_new} new historical point(s).")
    return 0


def cmd_report(conn, out: Path | None) -> int:
    path = generate_report(conn, out) if out else generate_report(conn)
    print(f"Wrote {path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
