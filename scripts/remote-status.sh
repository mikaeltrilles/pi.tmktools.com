#!/bin/bash
# remote-status.sh — État rapide de la production : PM2, port 3001, décimales publiées.
REMOTE="vote1550@109.234.165.174"
SSH_OPTS=(-F /dev/null -o BatchMode=yes -o ConnectTimeout=15)
ssh "${SSH_OPTS[@]}" "$REMOTE" '
  export PATH="/opt/alt/alt-nodejs22/root/usr/bin:$PATH"
  cd ~/pi.tmktools.com || exit 1
  echo "=== PM2 ==="; npx pm2 list 2>/dev/null | grep -E "pi-tmktools|status" || echo "(aucun processus PM2)"
  echo "=== Port 3001 ==="; curl -s -m 10 http://127.0.0.1:3001/stats | head -c 200; echo
  echo "=== Données ==="; head -n 3 data/pi_complet.txt; ls -la data/calculator_heartbeat.json 2>/dev/null
  echo "=== Keepalive ==="; tail -n 5 logs/keepalive.log 2>/dev/null || echo "(pas encore de log)"
' 2>&1 | grep -v "post-quantum\|store now\|openssh.com/pq"
echo "=== Site public ==="
curl -s -m 15 -o /dev/null -w "https://pi.tmktools.com → HTTP %{http_code}\n" https://pi.tmktools.com/
