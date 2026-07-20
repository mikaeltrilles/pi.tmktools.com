#!/bin/bash
# deploy.sh — Déploiement π Explorer sur vote1550@109.234.165.174
# Usage : ./deploy.sh [message de commit optionnel]
#
# Fonctionne avec ou sans rsync (fallback scp sur Windows/Git Bash).
# Déploie uniquement le code Node.js (pas le gros fichier pi_complet.txt).
# Pour déployer code + données π : voir deploy-with-data.sh
set -e

REMOTE="vote1550@109.234.165.174"
REMOTE_DIR="/home/vote1550/pi.tmktools.com"
COMMIT_MSG="${1:-deploy: $(date '+%Y-%m-%d %H:%M:%S')}"

# Liste des chemins à déployer (relatifs)
DEPLOY_FILES=(
  public
  server.js
  package.json
  package-lock.json
  .htaccess
)

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  🚀 Déploiement pi.tmktools.com"
echo "  $(date '+%Y-%m-%d %H:%M:%S')"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Hôte : $REMOTE"
echo "  Dossier distant : $REMOTE_DIR"
echo "  Commit : $COMMIT_MSG"
echo ""

# ── Vérification SSH ─────────────────────────────
echo "🔌 Vérification connexion SSH..."
if ! ssh -o BatchMode=yes -o ConnectTimeout=10 "$REMOTE" "echo OK" >/dev/null 2>&1; then
  echo "❌ Connexion SSH vers $REMOTE impossible."
  echo "   Vérifiez votre clé SSH et l'accès réseau."
  exit 1
fi
echo "✅ Connexion SSH OK"

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

# ── Déploiement distant ──────────────────────────
echo "🌐 Déploiement du code sur le serveur..."

# Déterminer si rsync est disponible localement
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
  # Nettoyer les fichiers distants déployés avant de les remplacer
  ssh "$REMOTE" "
    set -e
    mkdir -p $REMOTE_DIR/logs $REMOTE_DIR/data
    cd $REMOTE_DIR
    rm -rf public
    rm -f server.js package.json package-lock.json .htaccess
  "
  # Envoyer les nouveaux fichiers
  scp -r -o BatchMode=yes "${DEPLOY_FILES[@]}" "$REMOTE:$REMOTE_DIR/"
fi

echo "✅ Code copié sur le serveur"

# ── Installation & reload ───────────────────────
echo "🔄 Installation des dépendances et reload..."
ssh "$REMOTE" '
  set -e
  cd ~/pi.tmktools.com

  echo "📦 npm install..."
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

  echo "✅ Déployé : $(date +%Y-%m-%d\ %H:%M:%S)"
  npx pm2 list | grep pi-tmktools
'

echo ""
echo "✅ pi.tmktools.com est en ligne sur le port 3001 !"
echo "🔗 http://pi.tmktools.com"
echo ""
echo "💡 Pour déployer également les données π (pi_complet.txt), utilisez :"
echo "   ./deploy-with-data.sh"
