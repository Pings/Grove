# Covet

Price tracker & restock alerts — Grove tool at **`/covet/`** (`tools/price-tracker`).

Tracks product prices, backfills Wayback history on add, emails drop/special alerts via Gmail.

## Local

```bash
cd tools/price-tracker
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python -m price_tracker serve
```

Open [http://127.0.0.1:5050](http://127.0.0.1:5050).

In Docker/TrueNAS the same app is served at **`/covet/`** behind nginx.

## Categories

- **Watch** — one-off interest; email on price drops (Settings threshold)
- **Restock** — repeat buys (e.g. cat food); email on **≥20% specials** (configurable), and live checks only run near replacement time

### Restock fields

- **Bought** / **Bought** button — last purchase date, resets food to 100%
- **Days/pack** — how long a full pack lasts
- **Food %** — estimated remaining
- **Lead days** — start checking this many days before empty

Manual **Check** on a restock card always runs (forced). **Check due** only hits items in the lead window.

Gmail + thresholds live in Settings. `data/` is gitignored.
