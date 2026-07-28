#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

echo "==> Pulling latest from git..."
git pull --ff-only origin "$(git rev-parse --abbrev-ref HEAD)"

echo "==> Rebuilding and restarting Grove..."
docker compose build --pull
docker compose up -d

echo "==> Done. Grove is running on port 8080."
if [[ -f .env ]] && grep -q '^COMPOSE_PROFILES=.*cloudflare' .env 2>/dev/null; then
  echo "    Cloudflare Tunnel profile is enabled (grove-cloudflared)."
fi
docker compose ps
