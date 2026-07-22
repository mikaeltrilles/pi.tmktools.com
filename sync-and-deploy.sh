#!/bin/bash
# sync-and-deploy.sh — Synchronise les decimales calculees localement dans PIpi4
# et les deploie sur le serveur de production.
#
# Usage : ./sync-and-deploy.sh [message de commit optionnel]
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMMIT_MSG="${1:-deploy(data): sync depuis PIpi4 $(date '+%Y-%m-%d %H:%M:%S')}"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  🔄 Sync PIpi4 → picalc → production"
echo "  $(date '+%Y-%m-%d %H:%M:%S')"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# 1. Synchronisation locale
cd "$SCRIPT_DIR"
bash ./sync-pi-data.sh

# 2. Deploiement complet
echo ""
bash ./deploy-with-data.sh "$COMMIT_MSG"
