#!/bin/bash
# sync-and-deploy.sh — Synchronise les decimales calculees localement dans calculator/
# et les deploie sur le serveur de production.
#
# Usage : scripts/sync-and-deploy.sh [message de commit optionnel]
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"   # pi.tmktools.com/
CALC_DIR="$ROOT_DIR/calculator"
COMMIT_MSG="${1:-deploy(data): sync depuis calculator $(date '+%Y-%m-%d %H:%M:%S')}"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  🔄 Sync calculator → data → production"
echo "  $(date '+%Y-%m-%d %H:%M:%S')"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# 1. Synchronisation locale
cd "$ROOT_DIR"
bash "$SCRIPT_DIR/sync-pi-data.sh"

# 2. Deploiement complet
echo ""
bash "$SCRIPT_DIR/deploy-with-data.sh" "$COMMIT_MSG"
