#!/bin/bash
# install-remote-keepalive.sh — Installe (ou met à jour) le cron de surveillance
# PM2 sur le serveur de production. Idempotent : peut être relancé sans risque.
set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REMOTE="vote1550@109.234.165.174"
REMOTE_DIR="/home/vote1550/pi.tmktools.com"
SSH_OPTS=(-F /dev/null -o BatchMode=yes -o ConnectTimeout=15)
CRON_LINE="*/5 * * * * $REMOTE_DIR/scripts/remote-keepalive.sh >> $REMOTE_DIR/logs/keepalive.log 2>&1"

echo "🔌 Vérification connexion SSH..."
ssh "${SSH_OPTS[@]}" "$REMOTE" "mkdir -p $REMOTE_DIR/scripts $REMOTE_DIR/logs"
echo "📤 Envoi de remote-keepalive.sh..."
scp "${SSH_OPTS[@]}" -q "$SCRIPT_DIR/remote-keepalive.sh" "$REMOTE:$REMOTE_DIR/scripts/remote-keepalive.sh"
echo "⏰ Installation du cron (toutes les 5 minutes)..."
ssh "${SSH_OPTS[@]}" "$REMOTE" "
  chmod +x $REMOTE_DIR/scripts/remote-keepalive.sh
  ( crontab -l 2>/dev/null | grep -v 'remote-keepalive.sh' ; echo \"$CRON_LINE\" ) | crontab -
  echo '--- crontab actuel ---'
  crontab -l
"
echo "✅ Surveillance PM2 installée sur $REMOTE"
