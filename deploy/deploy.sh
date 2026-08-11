#!/usr/bin/env bash
# Pull latest Grove from git and rebuild containers (safe for TrueNAS cron).
# Preserves .env (ports, tunnel token). Skips work when already up to date.
#
# Dockge often rewrites compose.yaml in the stack folder. That file is gitignored;
# docker-compose.yml in git is the source of truth and is copied to compose.yaml
# after every successful update.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

BRANCH="${GROVE_BRANCH:-main}"
LOG_TAG="[xin-update $(date '+%Y-%m-%d %H:%M:%S')]"

mkdir -p "$ROOT/deploy"
LOCK="$ROOT/deploy/.update.lock"
exec 9>"$LOCK"
if ! flock -n 9; then
  echo "$LOG_TAG another update is already running — skip"
  exit 0
fi

if [[ ! -d .git ]]; then
  echo "$LOG_TAG ERROR: $ROOT is not a git repo" >&2
  exit 1
fi

# Drop local edits to tracked files so git never aborts (Dockge / manual tweaks).
# .env is not tracked and is left alone.
if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "$LOG_TAG discarding local git changes to tracked files (keeping .env)"
  git reset --hard HEAD
fi

echo "$LOG_TAG fetching origin/$BRANCH ..."
git fetch --prune origin "$BRANCH"

LOCAL="$(git rev-parse HEAD)"
REMOTE="$(git rev-parse "origin/$BRANCH")"

if [[ "$LOCAL" == "$REMOTE" && "${FORCE_REBUILD:-0}" != "1" ]]; then
  # Still refresh compose.yaml in case Dockge rewrote it.
  cp docker-compose.yml compose.yaml
  echo "$LOG_TAG already up to date ($(git rev-parse --short HEAD)) — nothing to rebuild"
  exit 0
fi

echo "$LOG_TAG updating $(git rev-parse --short "$LOCAL") → $(git rev-parse --short "$REMOTE")"
git checkout "$BRANCH"
git reset --hard "origin/$BRANCH"

# Dockge reads compose.yaml; regenerate from the repo’s compose file.
# Custom ports / tunnel live in .env (XIN_PORT, TUNNEL_TOKEN, COMPOSE_PROFILES).
cp docker-compose.yml compose.yaml

echo "$LOG_TAG rebuilding containers..."
if command -v docker >/dev/null 2>&1; then
  docker compose build
  docker compose up -d --build --remove-orphans
else
  echo "$LOG_TAG ERROR: docker not found" >&2
  exit 1
fi

PORT="$(grep -E '^XIN_PORT=' .env 2>/dev/null | cut -d= -f2- || true)"
PORT="${PORT:-8081}"
echo "$LOG_TAG done — now on $(git rev-parse --short HEAD) (host port ${PORT})"
if [[ -f .env ]] && grep -q '^COMPOSE_PROFILES=.*cloudflare' .env 2>/dev/null; then
  echo "$LOG_TAG cloudflare profile enabled"
fi
docker compose ps
