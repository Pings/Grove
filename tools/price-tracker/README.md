# Price Tracker

Grove tool at **`/prices/`** (`tools/price-tracker`).

Tracks product prices, backfills Wayback history on add, emails drop alerts via Gmail.

## Local

```bash
cd tools/price-tracker
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python -m price_tracker serve
```

Open [http://127.0.0.1:5050](http://127.0.0.1:5050).

In Docker/TrueNAS the same app is served at **`/prices/`** behind nginx.

## Settings

Gmail app password + drop % / $ thresholds in the web UI Settings page.

`data/` is gitignored (SQLite + credentials stay on the host / volume).
