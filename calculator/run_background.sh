#!/bin/bash
# Script de lancement en tache de fond du calcul de π sur Raspberry Pi 4
# Mode par defaut : calcul infini (non borne) avec reprise automatique.
#
# Ce script garantit UN SEUL processus calculate_pi.py actif a la fois.
# Il arrete d'abord proprement, puis force si necessaire, l'ancienne instance
# avant de demarrer la nouvelle.
#
# Usage :
#   ./run_background.sh                    # mode infini
#   ./run_background.sh --digits 50000       # mode fini : calcule exactement 50 000 decimales
#   ./run_background.sh --reset              # supprime le checkpoint et recommence a zero
#   ./run_background.sh --no-resume          # ne reprend pas le checkpoint existant
#

# Se deplace dans le repertoire du script
cd "$(dirname "$0")" || exit 1

# Arguments passes tels quels a python (ex: --digits 50000, --reset, --chunk 500)
ARGS="$@"

# -----------------------------------------------------------------------------
# 0. Garde-fou : le service systemd supervise-t-il deja le calcul ?
# -----------------------------------------------------------------------------
# Si pi-calculate.service tourne, un lancement manuel creerait un conflit :
# ce script tuerait le processus supervise, que systemd relancerait aussitot.
if systemctl --user is-active --quiet pi-calculate.service 2>/dev/null; then
    echo "=============================================="
    echo " ⚠️  pi-calculate.service est actif"
    echo "=============================================="
    echo "Le calcul est deja supervise par systemd ; un lancement manuel"
    echo "entrerait en conflit avec lui."
    echo ""
    echo "  Redemarrer le calcul      : systemctl --user restart pi-calculate.service"
    echo "  Arreter le calcul         : systemctl --user stop pi-calculate.service"
    echo "  Suivre l'etat du service  : systemctl --user status pi-calculate.service"
    echo ""
    echo "Pour reprendre la main manuellement (arguments specifiques,"
    echo "--reset, --digits...), arretez d'abord le service :"
    echo "  systemctl --user stop pi-calculate.service && ./run_background.sh $ARGS"
    exit 1
fi


echo "=============================================="
echo " Lancement controle de calculate_pi.py"
echo "=============================================="
echo "Repertoire        : $(pwd)"
echo "Fichier principal : $(pwd)/pi_complet.txt"
echo "Apercu temps reel : $(pwd)/pi_progress.txt"
echo "Checkpoint        : $(pwd)/pi_checkpoint.json"
echo "Log               : $(pwd)/pi_calculate.log"
echo "Sauvegardes       : /home/mitchlab/Documents"
echo ""

# -----------------------------------------------------------------------------
# 1. Arret de l'ancien processus calculate_pi.py s'il existe
# -----------------------------------------------------------------------------

echo "[1/3] Arret de l'ancien processus calculate_pi.py..."

# Methode 1 : arret propre via le fichier PID
if [ -f pi_calculate.pid ]; then
    OLD_PID=$(cat pi_calculate.pid 2>/dev/null)
    if [ -n "$OLD_PID" ] && kill -0 "$OLD_PID" 2>/dev/null; then
        echo "      Processus trouve (PID=$OLD_PID) -> envoi SIGTERM..."
        kill "$OLD_PID" 2>/dev/null
        # Attendre max 5 secondes l'arret naturel
        for i in 1 2 3 4 5; do
            if ! kill -0 "$OLD_PID" 2>/dev/null; then
                echo "      Processus $OLD_PID arrete proprement."
                break
            fi
            sleep 1
        done
    fi
fi

# Methode 2 : arret force si toujours present
RUNNING_PIDS=$(pgrep -f "python3 calculate_pi.py" || true)
if [ -n "$RUNNING_PIDS" ]; then
    echo "      Processus toujours actifs : $RUNNING_PIDS -> SIGKILL..."
    echo "$RUNNING_PIDS" | xargs -r kill -9 2>/dev/null
    sleep 1
fi

# Methode 3 : verification finale
RUNNING_PIDS=$(pgrep -f "python3 calculate_pi.py" || true)
if [ -n "$RUNNING_PIDS" ]; then
    echo "      ERREUR : impossible d'arreter les processus : $RUNNING_PIDS"
    echo "      Arret du script."
    exit 1
else
    echo "      Aucun processus calculate_pi.py actif."
fi

# Supprimer le fichier de lock s'il traine
if [ -f pi_calculate.lock ]; then
    rm -f pi_calculate.lock
    echo "      Fichier de lock supprime."
fi

# -----------------------------------------------------------------------------
# 2. Lancement du nouveau processus
# -----------------------------------------------------------------------------

echo ""
echo "[2/3] Demarrage du nouveau processus..."

if [ -z "$ARGS" ]; then
    nohup python3 calculate_pi.py > pi_calculate.log 2>&1 &
else
    nohup python3 calculate_pi.py $ARGS > pi_calculate.log 2>&1 &
fi

NEW_PID=$!
echo $NEW_PID > pi_calculate.pid
echo "      Nouveau PID : $NEW_PID"

# -----------------------------------------------------------------------------
# 3. Verification du demarrage
# -----------------------------------------------------------------------------

echo ""
echo "[3/3] Verification du demarrage..."
sleep 1

if kill -0 "$NEW_PID" 2>/dev/null; then
    echo "      Processus $NEW_PID actif."
    echo ""
    echo "=============================================="
    echo " ✅ calculate_pi.py demarre avec succes"
    echo "=============================================="
    echo ""
    echo "Pour suivre la progression :"
    echo "  tail -f $(pwd)/pi_progress.txt"
    echo "Pour voir le log complet :"
    echo "  tail -f $(pwd)/pi_calculate.log"
    echo "Pour arreter proprement :"
    echo "  kill \"\$(cat $(pwd)/pi_calculate.pid)\""
    echo ""
else
    echo "      ERREUR : le processus $NEW_PID ne tourne pas."
    echo "      Consultez $(pwd)/pi_calculate.log"
    exit 1
fi
