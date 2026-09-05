#!/bin/bash
# deploy-to-raspberry.sh — Envoie les fichiers metiers sur le Raspberry Pi 4
# et redemarre proprement le calculateur avec le nouveau calculate_pi.py.
#
# Usage : ./deploy-to-raspberry.sh [user@ip]
# Par defaut : mika@192.168.1.174 (voir README.md)
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REMOTE="${1:-mika@192.168.1.174}"
REMOTE_DIR="/home/mika/Public/PIpi4"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  🍓 Déploiement sur Raspberry Pi 4"
echo "  $(date '+%Y-%m-%d %H:%M:%S')"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Cible : $REMOTE:$REMOTE_DIR"
echo ""

# ── Vérification SSH ─────────────────────────────
echo "🔌 Vérification connexion SSH..."
if ! ssh -o BatchMode=yes -o ConnectTimeout=10 "$REMOTE" "echo OK" >/dev/null 2>&1; then
  echo "❌ Connexion SSH vers $REMOTE impossible."
  echo "   Vérifiez que le Raspberry est allume et accessible sur le reseau local."
  exit 1
fi
echo "✅ Connexion SSH OK"

# ── Envoi des fichiers ───────────────────────────
echo "📤 Envoi des fichiers sur le Raspberry..."
scp -o BatchMode=yes \
  "$SCRIPT_DIR/calculate_pi.py" \
  "$SCRIPT_DIR/run_background.sh" \
  "$SCRIPT_DIR/watch_and_restart.sh" \
  "$REMOTE:$REMOTE_DIR/"
echo "✅ Fichiers envoyes"

# ── Redemarrage du calculateur ─────────────────
echo "🔄 Redemarrage du calculateur avec le nouveau code..."
ssh -o BatchMode=yes "$REMOTE" "
  set -e
  cd $REMOTE_DIR
  chmod +x run_background.sh watch_and_restart.sh
  bash run_background.sh
"

echo ""
echo "✅ Raspberry Pi 4 mis a jour et calculateur relance !"
echo ""
echo "💡 Suivi du calcul :"
echo "   ssh $REMOTE 'tail -f $REMOTE_DIR/pi_calculate.log'"
echo "   ssh $REMOTE 'tail -f $REMOTE_DIR/pi_progress.txt'"
