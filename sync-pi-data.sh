#!/bin/bash
# sync-pi-data.sh — Synchronisation locale PIpi4/pi_complet.txt → picalc/data/pi_complet.txt
# Usage : ./sync-pi-data.sh
#
# Permet au serveur local picalc d'afficher les dernières décimales calculées
# par le Raspberry sans avoir besoin de redéployer sur Internet.
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SOURCE="$SCRIPT_DIR/../PIpi4/pi_complet.txt"
DEST="$SCRIPT_DIR/data/pi_complet.txt"
CHECKPOINT_SRC="$SCRIPT_DIR/../PIpi4/pi_checkpoint.json"
CHECKPOINT_DST="$SCRIPT_DIR/data/pi_checkpoint.json"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  🔄 Sync π local : PIpi4 → picalc"
echo "  $(date '+%Y-%m-%d %H:%M:%S')"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

if [ ! -f "$SOURCE" ]; then
  echo "❌ Fichier source introuvable : $SOURCE"
  echo "   Le calculateur PIpi4 n'a pas encore produit de pi_complet.txt."
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
