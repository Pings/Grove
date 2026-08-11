from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path

from . import db

REPORT_PATH = Path(__file__).resolve().parent.parent / "data" / "report.html"


def generate_report(conn, path: Path = REPORT_PATH) -> Path:
    products = db.list_products(conn)
    series = []
    for product in products:
        points = db.history(conn, product.id)
        series.append(
            {
                "id": product.id,
                "name": product.name,
                "url": product.url,
                "currency": product.currency,
                "points": [
                    {
                        "t": p.observed_at,
                        "price": p.price,
                        "source": p.source,
                        "availability": p.availability,
                    }
                    for p in points
                ],
            }
        )

    generated = datetime.now().astimezone().strftime("%Y-%m-%d %H:%M %Z")
    html = _TEMPLATE.replace("__GENERATED__", generated).replace(
        "__SERIES__", json.dumps(series)
    )
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(html, encoding="utf-8")
    return path


_TEMPLATE = """<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Price Tracker</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/chartjs-adapter-date-fns@3.0.0/dist/chartjs-adapter-date-fns.bundle.min.js"></script>
  <style>
    :root {
      --bg: #f3efe6;
      --ink: #1c1915;
      --muted: #6b6458;
      --line: #d4cdc0;
      --card: #fffdf8;
      --accent: #0f5c4c;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: "Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif;
      background:
        radial-gradient(circle at 10% 0%, #e8f0ea 0%, transparent 40%),
        radial-gradient(circle at 90% 10%, #efe6d8 0%, transparent 35%),
        var(--bg);
      color: var(--ink);
      min-height: 100vh;
    }
    main {
      max-width: 960px;
      margin: 0 auto;
      padding: 2.5rem 1.25rem 4rem;
    }
    h1 {
      font-size: clamp(2rem, 4vw, 2.75rem);
      font-weight: 600;
      letter-spacing: -0.02em;
      margin: 0 0 0.35rem;
    }
    .sub {
      color: var(--muted);
      margin: 0 0 2rem;
      font-size: 0.95rem;
    }
    .product {
      background: var(--card);
      border: 1px solid var(--line);
      border-radius: 12px;
      padding: 1.25rem 1.25rem 1.5rem;
      margin-bottom: 1.25rem;
    }
    .product h2 {
      margin: 0;
      font-size: 1.2rem;
      font-weight: 600;
    }
    .meta {
      color: var(--muted);
      font-size: 0.9rem;
      margin: 0.35rem 0 1rem;
    }
    .meta a { color: var(--accent); }
    .stats {
      display: flex;
      flex-wrap: wrap;
      gap: 1rem 1.5rem;
      margin-bottom: 1rem;
      font-variant-numeric: tabular-nums;
    }
    .stat strong { display: block; font-size: 1.35rem; }
    .stat span { color: var(--muted); font-size: 0.8rem; }
    canvas { width: 100% !important; max-height: 280px; }
    .empty { color: var(--muted); font-style: italic; }
  </style>
</head>
<body>
  <main>
    <h1>Price Tracker</h1>
    <p class="sub">Updated __GENERATED__</p>
    <div id="root"></div>
  </main>
  <script>
    const series = __SERIES__;
    const root = document.getElementById("root");
    const colors = ["#0f5c4c", "#8a4b2a", "#2c4a6e", "#6b3d5a", "#4a6b2c"];

    function fmt(currency, n) {
      try {
        return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(n);
      } catch {
        return currency + " " + n.toFixed(2);
      }
    }

    if (!series.length) {
      root.innerHTML = '<p class="empty">No products yet. Run: python -m price_tracker sync && python -m price_tracker check</p>';
    }

    series.forEach((product, i) => {
      const el = document.createElement("section");
      el.className = "product";
      const prices = product.points.map(p => p.price);
      const latest = prices.length ? prices[prices.length - 1] : null;
      const lowest = prices.length ? Math.min(...prices) : null;
      const highest = prices.length ? Math.max(...prices) : null;

      el.innerHTML = `
        <h2>${product.name}</h2>
        <p class="meta"><a href="${product.url}" target="_blank" rel="noopener">${product.url}</a>
          · ${product.points.length} observation(s)</p>
        <div class="stats">
          <div class="stat"><strong>${latest == null ? "—" : fmt(product.currency, latest)}</strong><span>Latest</span></div>
          <div class="stat"><strong>${lowest == null ? "—" : fmt(product.currency, lowest)}</strong><span>Low</span></div>
          <div class="stat"><strong>${highest == null ? "—" : fmt(product.currency, highest)}</strong><span>High</span></div>
        </div>
        <canvas id="chart-${product.id}" height="240"></canvas>
      `;
      root.appendChild(el);

      if (!product.points.length) {
        el.querySelector("canvas").replaceWith(Object.assign(document.createElement("p"), {
          className: "empty",
          textContent: "No price points yet."
        }));
        return;
      }

      new Chart(document.getElementById(`chart-${product.id}`), {
        type: "line",
        data: {
          datasets: [{
            label: product.name,
            data: product.points.map(p => ({ x: p.t, y: p.price })),
            borderColor: colors[i % colors.length],
            backgroundColor: colors[i % colors.length] + "22",
            tension: 0.25,
            pointRadius: 3,
            fill: true,
          }]
        },
        options: {
          responsive: true,
          plugins: { legend: { display: false } },
          scales: {
            x: { type: "time", time: { unit: "day" }, grid: { color: "#eee8dc" } },
            y: {
              ticks: { callback: v => fmt(product.currency, v) },
              grid: { color: "#eee8dc" }
            }
          }
        }
      });
    });
  </script>
</body>
</html>
"""
