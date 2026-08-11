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
}


@dataclass
class Product:
    id: int
    name: str
    url: str
    currency: str
    notes: str
    created_at: str


@dataclass
class PricePoint:
    id: int
    product_id: int
    price: float
    currency: str
    observed_at: str
    source: str
    availability: Optional[str]


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
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS prices (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
            price REAL NOT NULL,
            currency TEXT NOT NULL,
            observed_at TEXT NOT NULL,
            source TEXT NOT NULL,
            availability TEXT,
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
    _ensure_default_settings(conn)


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


def upsert_product(
    conn: sqlite3.Connection,
    *,
    name: str,
    url: str,
    currency: str = "NZD",
    notes: str = "",
) -> Product:
    now = datetime.now(timezone.utc).isoformat()
    conn.execute(
        """
        INSERT INTO products (name, url, currency, notes, created_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(url) DO UPDATE SET
            name = excluded.name,
            currency = excluded.currency,
            notes = excluded.notes
        """,
        (name, url.strip(), currency, notes, now),
    )
    conn.commit()
    row = conn.execute("SELECT * FROM products WHERE url = ?", (url.strip(),)).fetchone()
    return Product(**dict(row))


def list_products(conn: sqlite3.Connection) -> list[Product]:
    rows = conn.execute("SELECT * FROM products ORDER BY id").fetchall()
    return [Product(**dict(r)) for r in rows]


def get_product(conn: sqlite3.Connection, product_id: int) -> Optional[Product]:
    row = conn.execute("SELECT * FROM products WHERE id = ?", (product_id,)).fetchone()
    return Product(**dict(row)) if row else None


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
) -> bool:
    """Insert a price point. Returns True if a new row was inserted."""
    ts = observed_at.astimezone(timezone.utc).isoformat()
    cur = conn.execute(
        """
        INSERT OR IGNORE INTO prices
            (product_id, price, currency, observed_at, source, availability)
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        (product_id, price, currency, ts, source, availability),
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
    return [PricePoint(**dict(r)) for r in rows]


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
    return PricePoint(**dict(row)) if row else None


def latest_prices(conn: sqlite3.Connection) -> list[dict]:
    rows = conn.execute(
        """
        SELECT p.id, p.name, p.url, p.currency,
               pr.price, pr.observed_at, pr.source, pr.availability
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
            )
        )
    return synced
