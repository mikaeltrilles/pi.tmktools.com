#!/bin/bash
# sync-pi-data.sh — Synchronisation locale calculator/pi_complet.txt → data/pi_complet.txt
# Usage : scripts/sync-pi-data.sh
#
# Note : en local, server.js lit déjà calculator/pi_complet.txt directement ;
# cette copie sert surtout à préparer un deploy-with-data.sh ou à figer une version.
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"   # pi.tmktools.com/
CALC_DIR="$ROOT_DIR/calculator"
SOURCE="$CALC_DIR/pi_complet.txt"
DEST="$ROOT_DIR/data/pi_complet.txt"
CHECKPOINT_SRC="$CALC_DIR/pi_checkpoint.json"
CHECKPOINT_DST="$ROOT_DIR/data/pi_checkpoint.json"
HEARTBEAT_SRC="$CALC_DIR/calculator_heartbeat.json"
HEARTBEAT_DST="$ROOT_DIR/data/calculator_heartbeat.json"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  🔄 Sync π local : calculator → data"
echo "  $(date '+%Y-%m-%d %H:%M:%S')"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

if [ ! -f "$SOURCE" ]; then
  echo "❌ Fichier source introuvable : $SOURCE"
  echo "   Le calculateur (calculator/calculate_pi.py) n'a pas encore produit de pi_complet.txt."
  exit 1
fi

SRC_SIZE=$(stat -c%s "$SOURCE" 2>/dev/null || stat -f%z "$SOURCE")
SRC_DATE=$(stat -c%Y "$SOURCE" 2>/dev/null || stat -f%m "$SOURCE")

mkdir -p "$(dirname "$DEST")"

NEED_COPY=false
if [ ! -f "$DEST" ]; then
  NEED_COPY=true
  echo "📥 Aucun fichier local existant — copie initiale"
else
  DEST_SIZE=$(stat -c%s "$DEST" 2>/dev/null || stat -f%z "$DEST")
  DEST_DATE=$(stat -c%Y "$DEST" 2>/dev/null || stat -f%m "$DEST")
  if [ "$SRC_SIZE" -ne "$DEST_SIZE" ] || [ "$SRC_DATE" -gt "$DEST_DATE" ]; then
    NEED_COPY=true
    echo "📥 Nouvelle version détectée"
    echo "   Source : $SRC_SIZE octets"
    echo "   Local  : $DEST_SIZE octets"
  else
    echo "✅ Déjà à jour ($DEST_SIZE octets)"
  fi
fi

if [ "$NEED_COPY" = true ]; then
  cp "$SOURCE" "$DEST"
  if [ -f "$CHECKPOINT_SRC" ]; then
    cp "$CHECKPOINT_SRC" "$CHECKPOINT_DST"
  fi
  DST_SIZE=$(stat -c%s "$DEST" 2>/dev/null || stat -f%z "$DEST")
  echo "✅ Copié : $DST_SIZE octets"
  echo "💡 Redémarrez le serveur local (npm start) pour prendre en compte les nouvelles décimales,"
  echo "   ou utilisez le bouton Resync sur le site web."
fi

# Le heartbeat est toujours resynchronisé (petit fichier, mis à jour toutes les 60s
# par calculate_pi.py) pour que l'indicateur "Calcul actif" reste juste en local.
if [ -f "$HEARTBEAT_SRC" ]; then
  cp "$HEARTBEAT_SRC" "$HEARTBEAT_DST"
  echo "💓 Heartbeat synchronisé."
fi
