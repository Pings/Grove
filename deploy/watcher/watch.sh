#!/bin/sh
# Poll GitHub and rebuild the compose stack when the deploy branch moves.
# Runs inside the deploy-watcher container (docker.sock + identical host path mount).
set -eu

BRANCH="${DEPLOY_BRANCH:-main}"
POLL="${POLL_SECONDS:-60}"
REPO="${REPO_DIR:-${DEPLOY_HOST_PATH:-}}"

if [ -z "$REPO" ]; then
  echo "deploy-watcher: REPO_DIR / DEPLOY_HOST_PATH is not set" >&2
  exit 1
fi

cd "$REPO"
git config --global --add safe.directory "$REPO" 2>/dev/null || true

if [ -n "${DEPLOY_SSH_KEY:-}" ]; then
  if [ ! -f "$DEPLOY_SSH_KEY" ]; then
    echo "deploy-watcher: DEPLOY_SSH_KEY not found: $DEPLOY_SSH_KEY" >&2
    exit 1
  fi
  export GIT_SSH_COMMAND="${GIT_SSH_COMMAND:-ssh -i $DEPLOY_SSH_KEY -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new}"
fi

echo "deploy-watcher: watching $REPO (origin/$BRANCH) every ${POLL}s"

while true; do
  if ! git fetch origin "$BRANCH"; then
    echo "deploy-watcher: fetch failed; retry in ${POLL}s"
    sleep "$POLL"
    continue
  fi

  LOCAL="$(git rev-parse HEAD)"
  REMOTE="$(git rev-parse "origin/$BRANCH")"

  if [ "$LOCAL" != "$REMOTE" ]; then
    echo "deploy-watcher: updating ${LOCAL} -> ${REMOTE}"
    git checkout "$BRANCH"
    git reset --hard "origin/$BRANCH"

    # Dockge reads compose.yaml; keep it aligned with the repo file (.env stays local).
    if [ -f docker-compose.yml ]; then
      cp docker-compose.yml compose.yaml
    fi

    # Rebuild app services only — do not recreate cloudflared or this watcher
    # (full `compose up --build` restarts the tunnel and can kill this process).
    docker compose up -d --build --no-deps xin xin-sync
    echo "deploy-watcher: rebuild finished at $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  fi

  sleep "$POLL"
done
