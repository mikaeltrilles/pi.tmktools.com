#!/bin/bash
# deploy-protect-snapshot.sh — Crée et uploade un snapshot protecteur pi_20000000.txt
# contenant les decimales actuelles de data/pi_complet.txt.
#
# Ce snapshot sert de filet de securite : si le Raspberry ecrase accidentellement
# pi_complet.txt avec un fichier plus petit, le site web continuera d'afficher
# le maximum de decimales deja atteint (via pi_20000000.txt, palier valide).
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REMOTE="vote1550@109.234.165.174"
REMOTE_DIR="/home/vote1550/pi.tmktools.com/data"
LOCAL_PI="$SCRIPT_DIR/data/pi_complet.txt"
SNAPSHOT="$SCRIPT_DIR/data/pi_20000000.txt"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  🛡️  Snapshot protecteur π"
echo "  $(date '+%Y-%m-%d %H:%M:%S')"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

if [ ! -f "$LOCAL_PI" ]; then
  echo "❌ Fichier source introuvable : $LOCAL_PI"
  exit 1
fi

echo "📂 Generation du snapshot pi_20000000.txt depuis data/pi_complet.txt..."
node -e "
const fs = require('fs');
const content = fs.readFileSync('$LOCAL_PI'.replace(/\\/g, '/'), 'utf8');
const raw = content.split('\n').filter(l => !l.trim().startsWith('#')).join('').replace(/\s+/g, '').replace(/,/g, '');
const digits = raw.match(/-?\d*\.\d+/)[0].replace(/^-/, '');
const total = digits.length - 2;
const header = [
  '# Pi Digits made with ♥ by PI Explorer',
  '# Généré le : ' + new Date().toISOString(),
  '# Nombre total de décimales : ' + total,
  '# Source : snapshot protect 20M',
  '#',
  digits,
  ''
].join('\n');
fs.writeFileSync('$SNAPSHOT'.replace(/\\/g, '/'), header, 'utf8');
console.log('Snapshot genere : ' + total + ' decimales (' + fs.statSync('$SNAPSHOT'.replace(/\\/g, '/')).size + ' octets)');
"

echo "☁️  Upload du snapshot sur le serveur..."
scp -o BatchMode=yes "$SNAPSHOT" "$REMOTE:$REMOTE_DIR/pi_20000000.txt"

echo "✅ Snapshot protecteur deploye."
echo "   Le site affichera au minimum les decimales contenues dans ce snapshot,"
echo "   meme si pi_complet.txt est ecrase par un fichier plus petit."
