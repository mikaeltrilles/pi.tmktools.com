#!/bin/bash
# install-remote-keepalive.sh — Installe (ou met à jour) le contrôle de
# disponibilité PM2 sur le serveur de production. Idempotent.
#
# Depuis le 11 septembre 2026, la crontab du compte est assemblée à partir de
# fragments par ~/cron/apply-crontab.sh. On n'écrit donc PLUS la crontab
# directement (une ligne posée à la main serait effacée au prochain assemblage) :
# on dépose le fragment scripts/cron/55-pi.cron dans ~/cron/cron.d/, puis on
# laisse le script du serveur assembler l'ensemble.
set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REMOTE="vote1550@109.234.165.174"
REMOTE_DIR="/home/vote1550/pi.tmktools.com"
SSH_OPTS=(-F /dev/null -o BatchMode=yes -o ConnectTimeout=15)

echo "🔌 Vérification de la connexion SSH..."
ssh "${SSH_OPTS[@]}" "$REMOTE" "mkdir -p $REMOTE_DIR/scripts/cron $REMOTE_DIR/logs ~/cron/cron.d"

echo "📤 Envoi de remote-keepalive.sh et du fragment cron..."
scp "${SSH_OPTS[@]}" -q "$SCRIPT_DIR/remote-keepalive.sh" "$REMOTE:$REMOTE_DIR/scripts/remote-keepalive.sh"
scp "${SSH_OPTS[@]}" -q "$SCRIPT_DIR/cron/55-pi.cron" "$REMOTE:$REMOTE_DIR/scripts/cron/55-pi.cron"

echo "⏰ Installation du fragment puis assemblage de la crontab..."
ssh "${SSH_OPTS[@]}" "$REMOTE" "
  set -e
  chmod +x $REMOTE_DIR/scripts/remote-keepalive.sh
  cp $REMOTE_DIR/scripts/cron/55-pi.cron \$HOME/cron/cron.d/55-pi.cron

  # Retire une éventuelle ligne héritée dans un autre fragment, pour éviter un doublon.
  for f in \$HOME/cron/cron.d/*.cron; do
    [ \"\$f\" = \"\$HOME/cron/cron.d/55-pi.cron\" ] && continue
    if grep -q 'pi.tmktools.com/scripts/remote-keepalive.sh' \"\$f\" 2>/dev/null; then
      cp \"\$f\" \"\$f.bak-\$(date +%Y%m%d-%H%M%S)\"
      # '|| true' : grep -v renvoie 1 si le fragment ne contenait que cette ligne,
      # ce qui ferait échouer le script à cause de 'set -e'.
      grep -v 'pi.tmktools.com/scripts/remote-keepalive.sh' \"\$f\" > \"\$f.tmp\" || true
      mv \"\$f.tmp\" \"\$f\"
      echo \"   ligne héritée retirée de \$(basename \"\$f\")\"
    fi
  done

  if [ -x \$HOME/cron/apply-crontab.sh ]; then
    \$HOME/cron/apply-crontab.sh
  else
    echo '⚠️  ~/cron/apply-crontab.sh introuvable : appliquez la crontab manuellement.'
    exit 1
  fi

  echo '--- contrôle ---'
  crontab -l | grep --color=never 'pi.tmktools' || echo '❌ tâche absente de la crontab !'
"
echo "✅ Contrôle de disponibilité installé sur $REMOTE"
