#!/usr/bin/env bash
# Install a TrueNAS / root cron job that auto-updates Grove from git.
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
  echo "# Grove auto-update (git pull + rebuild)"
  echo "$CRON_LINE"
} >>"$TMP"
crontab "$TMP"
rm -f "$TMP"

echo "Installed cron:"
echo "  $CRON_LINE"
echo
echo "Logs: $LOG"
echo "Test now:  $DEPLOY"
echo "Force rebuild even if up to date:  FORCE_REBUILD=1 $DEPLOY"
