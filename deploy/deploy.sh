#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

echo "==> Pulling latest from git..."
git pull --ff-only origin "$(git rev-parse --abbrev-ref HEAD)"

# Dockge expects compose.yaml; keep it in sync with docker-compose.yml
if [[ -f docker-compose.yml ]]; then
  cp docker-compose.yml compose.yaml
fi

echo "==> Rebuilding and restarting Grove..."
docker compose build
docker compose up -d --build

echo "==> Done. Grove is running on port 8080."
if [[ -f .env ]] && grep -q '^COMPOSE_PROFILES=.*cloudflare' .env 2>/dev/null; then
  echo "    Cloudflare Tunnel profile is enabled (grove-cloudflared)."
fi
docker compose ps
