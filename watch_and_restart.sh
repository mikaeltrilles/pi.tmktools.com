#!/usr/bin/env bash
# -*- coding: utf-8 -*-
#
# Surveillance du processus calculate_pi.py.
# Si le PID enregistre n'existe plus ou si le processus n'est pas actif,
# on relance le calcul via run_background.sh.
#
# Important : le watchdog attend plusieurs minutes avant de declarer
# le processus mort, car un palier de 1000 decimales peut prendre plus
# d'une minute a haute precision. Cela evite les faux positifs et les
# rollbacks catastrophiques.
#
# Auteur : PI RasberryPi4

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PID_FILE="${SCRIPT_DIR}/pi_calculate.pid"
RUN_SCRIPT="${SCRIPT_DIR}/run_background.sh"
LOG_FILE="${SCRIPT_DIR}/pi_calculate.log"
WATCHDOG_LOG="${SCRIPT_DIR}/pi_watchdog.log"
# Delai pendant lequel le watchdog tolere l'absence temporaire du PID
# (en secondes). 5 minutes est une valeur conservative.
TOLERANCE_SECONDS=300

log_msg() {
    local msg="$1"
    local ts
    ts="$(date '+%Y-%m-%d %H:%M:%S %Z')"
    echo "[${ts}] 👁️  WATCHDOG ${msg}" | tee -a "${LOG_FILE}" 2>/dev/null || true
}

# Verifie si le processus calculate_pi.py est actif
check_running() {
    if [ -f "${PID_FILE}" ]; then
        local pid
        pid="$(cat "${PID_FILE}" 2>/dev/null || true)"
        if [ -n "${pid}" ] && kill -0 "${pid}" 2>/dev/null; then
            # Le PID existe, verifie que c'est bien python3
            if ps -p "${pid}" -o comm= 2>/dev/null | grep -q "python3"; then
                return 0
            fi
        fi
    fi

    # Verification de secours par pgrep
    if pgrep -f "python3 calculate_pi.py" >/dev/null 2>&1; then
        return 0
    fi

    return 1
}

# Si le processus tourne, ne rien faire immediatement
if check_running; then
    exit 0
fi

# Le processus semble absent. Attendre TOLERANCE_SECONDS et reverifier
# pour eviter de tuer un processus simplement ralenti par un palier long.
log_msg "Processus calculate_pi.py non detecte — attente de ${TOLERANCE_SECONDS}s avant action..."
sleep "${TOLERANCE_SECONDS}"

if check_running; then
    log_msg "Processus de retour apres attente — pas de relancement"
    exit 0
fi

log_msg "Processus toujours inactif apres ${TOLERANCE_SECONDS}s — relancement"

# Nettoyage des locks/pid obsolete au cas ou
rm -f "${SCRIPT_DIR}/pi_calculate.lock" "${PID_FILE}" 2>/dev/null || true

# Tue tout processus fantome restant
pgrep -f "python3 calculate_pi.py" | xargs -r kill -9 2>/dev/null || true

log_msg "Relancement de ${RUN_SCRIPT}..."
if bash "${RUN_SCRIPT}" >/dev/null 2>&1; then
    log_msg "Relancement reussi"
else
    log_msg "ERREUR lors du relancement"
    exit 1
fi
