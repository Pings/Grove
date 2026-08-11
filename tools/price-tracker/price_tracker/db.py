from __future__ import annotations

import sqlite3
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable, Optional

DEFAULT_DB = Path(__file__).resolve().parent.parent / "data" / "prices.db"

DEFAULT_SETTINGS = {
    "gmail_address": "",
    "gmail_app_password": "",
    "notify_to": "",
    "notify_enabled": "0",
    "drop_percent": "5",
    "drop_amount": "0",
    "repeat_special_percent": "20",
    "repeat_check_lead_days": "14",
}

PRODUCT_COLUMNS = {
    "category": "TEXT NOT NULL DEFAULT 'watch'",
    "last_purchased_at": "TEXT",
    "days_supply": "REAL",
    "food_level_pct": "REAL",
    "food_level_set_at": "TEXT",
    "check_lead_days": "INTEGER",
    "special_threshold_pct": "REAL",
}

PRICE_COLUMNS = {
    "list_price": "REAL",
    "discount_percent": "REAL",
}


@dataclass
class Product:
    id: int
    name: str
    url: str
    currency: str
    notes: str
    created_at: str
    category: str = "watch"
    last_purchased_at: Optional[str] = None
    days_supply: Optional[float] = None
    food_level_pct: Optional[float] = None
    food_level_set_at: Optional[str] = None
    check_lead_days: Optional[int] = None
    special_threshold_pct: Optional[float] = None


@dataclass
class PricePoint:
    id: int
    product_id: int
    price: float
    currency: str
    observed_at: str
    source: str
    availability: Optional[str]
    list_price: Optional[float] = None
    discount_percent: Optional[float] = None


def connect(db_path: Path = DEFAULT_DB) -> sqlite3.Connection:
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db(conn: sqlite3.Connection) -> None:
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS products (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            url TEXT NOT NULL UNIQUE,
            currency TEXT NOT NULL DEFAULT 'NZD',
            notes TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL,
            category TEXT NOT NULL DEFAULT 'watch',
            last_purchased_at TEXT,
            days_supply REAL,
            food_level_pct REAL,
            food_level_set_at TEXT,
            check_lead_days INTEGER,
            special_threshold_pct REAL
        );

        CREATE TABLE IF NOT EXISTS prices (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
            price REAL NOT NULL,
            currency TEXT NOT NULL,
            observed_at TEXT NOT NULL,
            source TEXT NOT NULL,
            availability TEXT,
            list_price REAL,
            discount_percent REAL,
            UNIQUE(product_id, observed_at, source)
        );

        CREATE INDEX IF NOT EXISTS idx_prices_product_time
            ON prices(product_id, observed_at);

        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS notifications (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
            old_price REAL NOT NULL,
            new_price REAL NOT NULL,
            currency TEXT NOT NULL,
            sent_at TEXT NOT NULL,
            status TEXT NOT NULL,
            detail TEXT NOT NULL DEFAULT ''
        );
        """
    )
    conn.commit()
    _migrate_columns(conn, "products", PRODUCT_COLUMNS)
    _migrate_columns(conn, "prices", PRICE_COLUMNS)
    _ensure_default_settings(conn)


def _migrate_columns(conn: sqlite3.Connection, table: str, columns: dict[str, str]) -> None:
    existing = {row[1] for row in conn.execute(f"PRAGMA table_info({table})")}
    for name, decl in columns.items():
        if name not in existing:
            conn.execute(f"ALTER TABLE {table} ADD COLUMN {name} {decl}")
    conn.commit()


def _ensure_default_settings(conn: sqlite3.Connection) -> None:
    for key, value in DEFAULT_SETTINGS.items():
        conn.execute(
            "INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)",
            (key, value),
        )
    conn.commit()


def get_settings(conn: sqlite3.Connection) -> dict[str, str]:
    rows = conn.execute("SELECT key, value FROM settings").fetchall()
    settings = dict(DEFAULT_SETTINGS)
    settings.update({r["key"]: r["value"] for r in rows})
    return settings


def update_settings(conn: sqlite3.Connection, values: dict[str, str]) -> dict[str, str]:
    for key, value in values.items():
        if key not in DEFAULT_SETTINGS:
            continue
        conn.execute(
            """
            INSERT INTO settings (key, value) VALUES (?, ?)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value
            """,
            (key, value),
        )
    conn.commit()
    return get_settings(conn)


def _row_product(row: sqlite3.Row) -> Product:
    data = dict(row)
    for key in PRODUCT_COLUMNS:
        data.setdefault(key, None)
    if not data.get("category"):
        data["category"] = "watch"
    return Product(**data)


def _row_price(row: sqlite3.Row) -> PricePoint:
    data = dict(row)
    data.setdefault("list_price", None)
    data.setdefault("discount_percent", None)
    return PricePoint(**data)


def upsert_product(
    conn: sqlite3.Connection,
    *,
    name: str,
    url: str,
    currency: str = "NZD",
    notes: str = "",
    category: str = "watch",
) -> Product:
    now = datetime.now(timezone.utc).isoformat()
    category = category if category in {"watch", "repeat"} else "watch"
    conn.execute(
        """
        INSERT INTO products (name, url, currency, notes, created_at, category)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(url) DO UPDATE SET
            name = excluded.name,
            currency = excluded.currency,
            notes = excluded.notes,
            category = excluded.category
        """,
        (name, url.strip(), currency, notes, now, category),
    )
    conn.commit()
    row = conn.execute("SELECT * FROM products WHERE url = ?", (url.strip(),)).fetchone()
    return _row_product(row)


def update_restock(
    conn: sqlite3.Connection,
    product_id: int,
    *,
    last_purchased_at: Optional[str] = None,
    days_supply: Optional[float] = None,
    food_level_pct: Optional[float] = None,
    check_lead_days: Optional[int] = None,
    special_threshold_pct: Optional[float] = None,
    mark_purchased: bool = False,
) -> Optional[Product]:
    product = get_product(conn, product_id)
    if not product:
        return None

    purchased = last_purchased_at if last_purchased_at is not None else product.last_purchased_at
    supply = days_supply if days_supply is not None else product.days_supply
    level = food_level_pct if food_level_pct is not None else product.food_level_pct
    lead = check_lead_days if check_lead_days is not None else product.check_lead_days
    threshold = (
        special_threshold_pct
        if special_threshold_pct is not None
        else product.special_threshold_pct
    )
    level_set = product.food_level_set_at

    if mark_purchased:
        purchased = (last_purchased_at or datetime.now(timezone.utc).date().isoformat())[:10]
        level = 100.0 if food_level_pct is None else float(food_level_pct)
        level_set = purchased
    elif food_level_pct is not None:
        level = float(food_level_pct)
        level_set = datetime.now(timezone.utc).date().isoformat()

    conn.execute(
        """
        UPDATE products SET
            last_purchased_at = ?,
            days_supply = ?,
            food_level_pct = ?,
            food_level_set_at = ?,
            check_lead_days = ?,
            special_threshold_pct = ?
        WHERE id = ?
        """,
        (purchased, supply, level, level_set, lead, threshold, product_id),
    )
    conn.commit()
    return get_product(conn, product_id)


def list_products(conn: sqlite3.Connection, category: Optional[str] = None) -> list[Product]:
    if category:
        rows = conn.execute(
            "SELECT * FROM products WHERE category = ? ORDER BY id", (category,)
        ).fetchall()
    else:
        rows = conn.execute("SELECT * FROM products ORDER BY id").fetchall()
    return [_row_product(r) for r in rows]


def get_product(conn: sqlite3.Connection, product_id: int) -> Optional[Product]:
    row = conn.execute("SELECT * FROM products WHERE id = ?", (product_id,)).fetchone()
    return _row_product(row) if row else None


def delete_product(conn: sqlite3.Connection, product_id: int) -> bool:
    cur = conn.execute("DELETE FROM products WHERE id = ?", (product_id,))
    conn.commit()
    return cur.rowcount > 0


def add_price(
    conn: sqlite3.Connection,
    *,
    product_id: int,
    price: float,
    currency: str,
    observed_at: datetime,
    source: str,
    availability: Optional[str] = None,
    list_price: Optional[float] = None,
    discount_percent: Optional[float] = None,
) -> bool:
    ts = observed_at.astimezone(timezone.utc).isoformat()
    cur = conn.execute(
        """
        INSERT OR IGNORE INTO prices
            (product_id, price, currency, observed_at, source, availability,
             list_price, discount_percent)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            product_id,
            price,
            currency,
            ts,
            source,
            availability,
            list_price,
            discount_percent,
        ),
    )
    conn.commit()
    return cur.rowcount > 0


def history(
    conn: sqlite3.Connection,
    product_id: int,
    *,
    limit: Optional[int] = None,
) -> list[PricePoint]:
    sql = """
        SELECT * FROM prices
        WHERE product_id = ?
        ORDER BY observed_at ASC
    """
    params: list = [product_id]
    if limit is not None:
        sql = """
            SELECT * FROM (
                SELECT * FROM prices
                WHERE product_id = ?
                ORDER BY observed_at DESC
                LIMIT ?
            ) ORDER BY observed_at ASC
        """
        params.append(limit)
    rows = conn.execute(sql, params).fetchall()
    return [_row_price(r) for r in rows]


def latest_price(
    conn: sqlite3.Connection,
    product_id: int,
    *,
    source: Optional[str] = None,
) -> Optional[PricePoint]:
    if source:
        row = conn.execute(
            """
            SELECT * FROM prices
            WHERE product_id = ? AND source = ?
            ORDER BY observed_at DESC
            LIMIT 1
            """,
            (product_id, source),
        ).fetchone()
    else:
        row = conn.execute(
            """
            SELECT * FROM prices
            WHERE product_id = ?
            ORDER BY observed_at DESC
            LIMIT 1
            """,
            (product_id,),
        ).fetchone()
    return _row_price(row) if row else None


def latest_prices(conn: sqlite3.Connection, category: Optional[str] = None) -> list[dict]:
    if category:
        rows = conn.execute(
            """
            SELECT p.*, pr.price AS price, pr.observed_at AS observed_at,
                   pr.source AS source, pr.availability AS availability,
                   pr.list_price AS list_price, pr.discount_percent AS discount_percent
            FROM products p
            LEFT JOIN prices pr ON pr.id = (
                SELECT id FROM prices
                WHERE product_id = p.id
                ORDER BY observed_at DESC
                LIMIT 1
            )
            WHERE p.category = ?
            ORDER BY p.id
            """,
            (category,),
        ).fetchall()
    else:
        rows = conn.execute(
            """
            SELECT p.*, pr.price AS price, pr.observed_at AS observed_at,
                   pr.source AS source, pr.availability AS availability,
                   pr.list_price AS list_price, pr.discount_percent AS discount_percent
            FROM products p
            LEFT JOIN prices pr ON pr.id = (
                SELECT id FROM prices
                WHERE product_id = p.id
                ORDER BY observed_at DESC
                LIMIT 1
            )
            ORDER BY p.id
            """
        ).fetchall()
    return [dict(r) for r in rows]


def log_notification(
    conn: sqlite3.Connection,
    *,
    product_id: int,
    old_price: float,
    new_price: float,
    currency: str,
    status: str,
    detail: str = "",
) -> None:
    conn.execute(
        """
        INSERT INTO notifications
            (product_id, old_price, new_price, currency, sent_at, status, detail)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        """,
        (
            product_id,
            old_price,
            new_price,
            currency,
            datetime.now(timezone.utc).isoformat(),
            status,
            detail,
        ),
    )
    conn.commit()


def sync_products_from_config(conn: sqlite3.Connection, products: Iterable[dict]) -> list[Product]:
    synced = []
    for item in products:
        synced.append(
            upsert_product(
                conn,
                name=item["name"],
                url=item["url"],
                currency=item.get("currency", "NZD"),
                notes=item.get("notes", ""),
                category=item.get("category", "watch"),
            )
        )
        product = synced[-1]
        if item.get("category") == "repeat" or any(
            k in item for k in ("days_supply", "last_purchased_at", "food_level_pct")
        ):
            update_restock(
                conn,
                product.id,
                last_purchased_at=item.get("last_purchased_at"),
                days_supply=item.get("days_supply"),
                food_level_pct=item.get("food_level_pct"),
                check_lead_days=item.get("check_lead_days"),
                special_threshold_pct=item.get("special_threshold_pct"),
            )
            synced[-1] = get_product(conn, product.id) or product
    return synced
