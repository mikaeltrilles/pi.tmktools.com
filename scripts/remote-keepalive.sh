#!/bin/bash
# remote-keepalive.sh — À installer SUR LE SERVEUR (vote1550@109.234.165.174) en cron.
#
# Contexte : sur l'hébergement mutualisé, le démon PM2 peut être tué (nettoyage
# des processus, mise à jour du nœud...). L'application Node disparaît alors,
# plus rien n'écoute sur le port 3001 et Apache renvoie « 503 Service Unavailable ».
# Ce script vérifie toutes les 5 minutes que le site répond et relance PM2 sinon.
#
# Installation (une seule fois, sur le serveur) :
#   crontab -e
#   */5 * * * * /home/vote1550/pi.tmktools.com/scripts/remote-keepalive.sh >> /home/vote1550/pi.tmktools.com/logs/keepalive.log 2>&1
#
# scripts/install-remote-keepalive.sh fait cette installation depuis le poste local.
APP_DIR="${APP_DIR:-$HOME/pi.tmktools.com}"
PORT="${PORT:-3001}"
APP_NAME="pi-tmktools"
export PATH="/opt/alt/alt-nodejs22/root/usr/bin:$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin:$PATH"

cd "$APP_DIR" || exit 1
mkdir -p logs

if curl -s -m 10 -o /dev/null -w '%{http_code}' "http://127.0.0.1:${PORT}/stats" | grep -q '^200$'; then
  exit 0   # tout va bien, silencieux
fi

echo "[$(date '+%Y-%m-%d %H:%M:%S')] ⚠️  Port ${PORT} muet — relance de ${APP_NAME} via PM2"
# `pm2 startOrRestart` recrée le démon PM2 s'il est mort, puis (re)lance l'app.
if npx pm2 startOrRestart ecosystem.config.js --update-env >/dev/null 2>&1; then
  npx pm2 save >/dev/null 2>&1
  sleep 5
  CODE=$(curl -s -m 10 -o /dev/null -w '%{http_code}' "http://127.0.0.1:${PORT}/stats")
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] ✅ Relance effectuée — HTTP ${CODE} sur le port ${PORT}"
else
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] ❌ Échec de la relance PM2"
  exit 1
fi
