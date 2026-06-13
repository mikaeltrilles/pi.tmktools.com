#!/bin/bash
# deploy.sh — Déploiement π Explorer sur vote1550@109.234.165.174
# Usage : ./deploy.sh [message de commit optionnel]
set -e

REMOTE="vote1550@109.234.165.174"
REMOTE_DIR="$HOME/pi.tmktools.com"
COMMIT_MSG="${1:-deploy: $(date '+%Y-%m-%d %H:%M:%S')}"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  🚀 Déploiement pi.tmktools.com"
echo "  $(date '+%Y-%m-%d %H:%M:%S')"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# ── Commit & push local ──────────────────────────
echo "📤 Git commit & push SSH..."
git add -A

if git diff --cached --quiet; then
  echo "   (rien à committer)"
else
  git commit -m "$COMMIT_MSG"
fi

git push origin main
echo "✅ Code pushé sur GitHub"

# ── Déploiement distant (SCP + reload) ───────────
echo "🌐 Déploiement sur le serveur..."

# Copier les fichiers sources (sans node_modules ni data)
rsync -az --delete \
  --exclude=node_modules \
  --exclude=data \
  --exclude=logs \
  --exclude=.git \
  ./ "$REMOTE:$REMOTE_DIR/"

ssh "$REMOTE" '
  set -e
  cd ~/pi.tmktools.com

  echo "📦 Dépendances..."
  npm install --production --silent

  # S assurer que pm2 est installé localement
  if [ ! -d node_modules/pm2 ]; then
    npm install pm2 --silent
  fi

  echo "🔄 Rechargement PM2..."
  npx pm2 reload pi-tmktools --update-env || npx pm2 start server.js \
    --name pi-tmktools \
    --cwd ~/pi.tmktools.com \
    --log ~/pi.tmktools.com/logs/pi-tmktools.log \
    --max-memory-restart 256M \
    --restart-delay 2000 \
    -- --port 3001

  npx pm2 save

  echo "✅ Déployé : $(date '+%Y-%m-%d %H:%M:%S')"
  npx pm2 list | grep pi-tmktools
'

echo ""
echo "✅ pi.tmktools.com est en ligne sur le port 3001 !"
echo "🔗 http://pi.tmktools.com"
echo ""
echo "⚠️  IMPORTANT : Configurez le reverse proxy dans cPanel"
echo "   → 'Setup Node.js App' ou 'Node.js Selector'"
echo "   → Pointez pi.tmktools.com vers le port 3001"
