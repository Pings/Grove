#!/usr/bin/env bash
# Optional fallback: install a TrueNAS / root cron job that auto-updates Grove from git.
# Prefer the deploy-watcher compose profile (see README) when possible.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEPLOY="$ROOT/deploy/deploy.sh"
LOG="$ROOT/deploy/update.log"
# Daily at 04:15 (TrueNAS local time)
SCHEDULE="${GROVE_UPDATE_SCHEDULE:-15 4 * * *}"

chmod +x "$DEPLOY"

CRON_LINE="$SCHEDULE $DEPLOY >> $LOG 2>&1"

# Remove any previous Grove auto-update lines, then add ours
TMP="$(mktemp)"
crontab -l 2>/dev/null | grep -v 'deploy/deploy.sh' | grep -v 'Grove auto-update' >"$TMP" || true
{
  echo "# Grove auto-update (git pull + rebuild) — prefer compose profile 'watcher' if available"
  echo "$CRON_LINE"
} >>"$TMP"
crontab "$TMP"
rm -f "$TMP"

echo "Installed cron:"
echo "  $CRON_LINE"
echo
echo "Logs: $LOG"
echo "Prefer deploy-watcher: set COMPOSE_PROFILES=...,watcher and DEPLOY_HOST_PATH in .env"
echo "Test now:  $DEPLOY"
echo "Force rebuild even if up to date:  FORCE_REBUILD=1 $DEPLOY"
