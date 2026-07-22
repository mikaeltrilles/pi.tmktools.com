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
python3 - "$LOCAL_PI" "$SNAPSHOT" <<'PY'
import re, sys, datetime
src, dst = sys.argv[1], sys.argv[2]
with open(src, 'r', encoding='utf-8') as f:
    content = f.read()
raw = ''.join(l for l in content.split('\n') if not l.strip().startswith('#'))
raw = re.sub(r'\s+', '', raw).replace(',', '')
match = re.search(r'-?\d*\.\d+', raw)
digits = match.group(0).lstrip('-')
if digits.startswith('.'):
    digits = '3' + digits
total = len(digits) - 2
header = '\n'.join([
    '# Pi Digits made with ♥ by PI Explorer',
    '# Généré le : ' + datetime.datetime.now(datetime.timezone.utc).isoformat(),
    '# Nombre total de décimales : ' + str(total),
    '# Source : snapshot protect 20M',
    '#',
    digits,
    ''
])
with open(dst, 'w', encoding='utf-8') as f:
    f.write(header)
print(f'Snapshot genere : {total} decimales')
PY

echo "☁️  Upload du snapshot sur le serveur..."
scp -o BatchMode=yes "$SNAPSHOT" "$REMOTE:$REMOTE_DIR/pi_20000000.txt"

echo "✅ Snapshot protecteur deploye."
echo "   Le site affichera au minimum les decimales contenues dans ce snapshot,"
echo "   meme si pi_complet.txt est ecrase par un fichier plus petit."
