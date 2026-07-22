#!/bin/bash
# deploy-with-data.sh — Déploiement complet : code + données π
# Usage : ./deploy-with-data.sh [message de commit optionnel]
#
# Ce script :
#   1. Copie PIpi4/pi_complet.txt dans picalc/data/pi_complet.txt
#   2. Commit & push le code (sans le gros fichier data/pi_complet.txt, géré par .gitignore)
#   3. Déploie le code sur le serveur (rsync ou scp)
#   4. Upload pi_complet.txt sur le serveur de production
#   5. Recharge le serveur Node.js/PM2
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REMOTE="vote1550@109.234.165.174"
REMOTE_DIR="/home/vote1550/pi.tmktools.com"
REMOTE_DATA_DIR="$REMOTE_DIR/data"
COMMIT_MSG="${1:-deploy(data): $(date '+%Y-%m-%d %H:%M:%S')}"

LOCAL_PIPI4_FILE="$SCRIPT_DIR/../PIpi4/pi_complet.txt"
LOCAL_DATA_FILE="$SCRIPT_DIR/data/pi_complet.txt"
LOCAL_CHECKPOINT_FILE="$SCRIPT_DIR/data/pi_checkpoint.json"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  🚀 Déploiement COMPLET pi.tmktools.com"
echo "  $(date '+%Y-%m-%d %H:%M:%S')"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# ── Vérification SSH ─────────────────────────────
echo "🔌 Vérification connexion SSH..."
if ! ssh -o BatchMode=yes -o ConnectTimeout=10 "$REMOTE" "echo OK" >/dev/null 2>&1; then
  echo "❌ Connexion SSH vers $REMOTE impossible."
  exit 1
fi
echo "✅ Connexion SSH OK"

# ── Synchronisation locale des données π ─────────
echo "📂 Synchronisation PIpi4 → picalc/data..."
if [ -f "$LOCAL_PIPI4_FILE" ]; then
  mkdir -p "$(dirname "$LOCAL_DATA_FILE")"
  cp "$LOCAL_PIPI4_FILE" "$LOCAL_DATA_FILE"
  echo "✅ Copié : $(stat -c%s "$LOCAL_DATA_FILE" 2>/dev/null || stat -f%z "$LOCAL_DATA_FILE") octets"
else
  echo "⚠️  Fichier source absent : $LOCAL_PIPI4_FILE"
  echo "   Le site utilisera le pi_complet.txt déjà présent."
fi

# Copie optionnelle du checkpoint pour archive locale
if [ -f "$SCRIPT_DIR/../PIpi4/pi_checkpoint.json" ]; then
  cp "$SCRIPT_DIR/../PIpi4/pi_checkpoint.json" "$LOCAL_CHECKPOINT_FILE"
fi

# ── Commit & push local ──────────────────────────
echo "📤 Git commit & push..."
cd "$SCRIPT_DIR"
git add -A

if git diff --cached --quiet; then
  echo "   (rien à committer)"
else
  git commit -m "$COMMIT_MSG"
fi

git push origin main
echo "✅ Code pushé sur GitHub"

# ── Déploiement du code ──────────────────────────
echo "🌐 Déploiement du code sur le serveur..."
DEPLOY_FILES=(public server.js ecosystem.config.js package.json package-lock.json .htaccess deploy.sh deploy-with-data.sh sync-pi-data.sh)

if command -v rsync >/dev/null 2>&1; then
  echo "   Utilisation de rsync..."
  rsync -az --delete \
    --exclude=node_modules \
    --exclude=data \
    --exclude=logs \
    --exclude=.git \
    ./ "$REMOTE:$REMOTE_DIR/"
else
  echo "   rsync absent — utilisation de scp (fallback)"
  ssh "$REMOTE" "
    set -e
    mkdir -p $REMOTE_DIR/logs $REMOTE_DIR/data
    cd $REMOTE_DIR
    rm -rf public
    rm -f server.js ecosystem.config.js package.json package-lock.json .htaccess deploy.sh deploy-with-data.sh sync-pi-data.sh
  "
  scp -r -o BatchMode=yes "${DEPLOY_FILES[@]}" "$REMOTE:$REMOTE_DIR/"
fi
echo "✅ Code copié sur le serveur"

# ── Upload du fichier π ──────────────────────────
echo "☁️  Upload de pi_complet.txt sur le serveur..."
if [ -f "$LOCAL_DATA_FILE" ]; then
  # Upload atomique via fichier temporaire
  scp -o BatchMode=yes "$LOCAL_DATA_FILE" "$REMOTE:$REMOTE_DATA_DIR/pi_complet.txt.tmp"
  ssh "$REMOTE" "
    set -e
    mv $REMOTE_DATA_DIR/pi_complet.txt.tmp $REMOTE_DATA_DIR/pi_complet.txt
    echo \"✅ Fichier π installé : \$(stat -c%s $REMOTE_DATA_DIR/pi_complet.txt 2>/dev/null || stat -f%z $REMOTE_DATA_DIR/pi_complet.txt) octets\"
  "
else
  echo "⚠️  Aucun fichier local pi_complet.txt à uploader."
fi

# ── Installation & reload ────────────────────────
echo "🔄 Installation des dépendances et reload..."
ssh "$REMOTE" '
  set -e
  cd ~/pi.tmktools.com

  echo "📦 npm install..."
  npm install --production --silent

  if [ ! -d node_modules/pm2 ]; then
    npm install pm2 --silent
  fi

  echo "🔄 Rechargement PM2..."
  if [ -f ecosystem.config.js ]; then
    npx pm2 reload ecosystem.config.js --update-env \
      || npx pm2 start ecosystem.config.js
  else
    npx pm2 reload pi-tmktools --update-env \
      || npx pm2 start server.js \
          --name pi-tmktools \
          --cwd ~/pi.tmktools.com \
          --max-memory-restart 1G \
          --restart-delay 3000 \
          -- --port 3001
  fi

  npx pm2 save

  echo "✅ Déployé : $(date +%Y-%m-%d\ %H:%M:%S)"
  npx pm2 list | grep pi-tmktools
'

# ── Vérification finale ──────────────────────────
echo ""
echo "🔍 Vérification finale..."
sleep 3
REMOTE_TOTAL=$(curl -s https://pi.tmktools.com/stats | grep -o '"total_digits_stored":[0-9]*' | cut -d: -f2 || echo "0")
if [ "$REMOTE_TOTAL" -gt 0 ] 2>/dev/null; then
  echo "✅ Site en production : $REMOTE_TOTAL décimales de π disponibles"
else
  echo "⚠️  Impossible de vérifier le nombre de décimales distantes."
fi

echo ""
echo "✅ Déploiement complet terminé !"
echo "🔗 https://pi.tmktools.com"
