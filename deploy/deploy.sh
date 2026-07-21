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
docker compose ps
