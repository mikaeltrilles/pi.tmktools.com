#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Calcul de π par l'algorithme de Chudnovsky en arithmetique entiere (BigInt).

Mode principal : calcul NON BORNE (infini) par paliers de 1000 decimales.
- Le programme tourne en boucle jusqu'a interruption manuelle.
- Chaque palier termine, le fichier pi_complet.txt est mis a jour.
- Une copie de sauvegarde est effectuee dans /home/mitchlab/Documents.
- Seuls les 3 derniers backups sont conserves (rotation automatique).
- L'etat du calcul est sauvegarde dans pi_checkpoint.json apres chaque palier,
  ce qui permet de reprendre exactement la ou le programme s'est arrete.
- Le fichier pi_complet.txt est upload automatiquement par SCP vers le serveur
  de production apres chaque palier.

Algorithme incremental : on maintient la somme partielle sous la forme
S_n = P_n / (-640320^3)^n, ce qui permet d'ajouter des termes par blocs sans
recalculer la serie depuis le debut a chaque palier.

Emplacement : pi.tmktools.com/calculator/ (le site Node.js vit a la racine
du meme depot et lit directement calculator/pi_complet.txt en local).

Auteur : PI RasberryPi4
"""


# Désactiver la limite de conversion int<->str pour les très grands entiers
# (Chudnovsky produit des nombres à millions de chiffres). Doit être fait AVANT
# l'import de json car json.load appelle int() sur les grands littéraux.
import sys
if hasattr(sys, "set_int_max_str_digits"):
    sys.set_int_max_str_digits(0)

# Fuseau horaire Europe/Paris pour les logs et l'en-tete du fichier π
import os
import shutil
import signal
import json
import datetime
import argparse
import subprocess
import threading
import unicodedata
from pathlib import Path
from typing import Optional

# Tous les fichiers de travail (pi_complet.txt, checkpoint, log, lock...) vivent
# dans le dossier du script : pi.tmktools.com/calculator/. On s'y place
# systematiquement pour que le lancement soit independant du repertoire courant
# (systemd, run_background.sh, PowerShell, appel direct...).
BASE_DIR = Path(__file__).resolve().parent
ROOT_DIR = BASE_DIR.parent          # pi.tmktools.com/
SITE_DATA_DIR = ROOT_DIR / "data"   # donnees lues par server.js (snapshots pi_N.txt)
os.chdir(BASE_DIR)

# Fuseau horaire Europe/Paris pour les logs et l'en-tete du fichier π
try:
    import zoneinfo
    TZ_PARIS = zoneinfo.ZoneInfo("Europe/Paris")
except ImportError:
    # Python < 3.9 : fallback sur pytz s'il est installe
    try:
        from pytz import timezone
        TZ_PARIS = timezone("Europe/Paris")
    except ImportError:
        TZ_PARIS = datetime.timezone.utc

CHUNK_SIZE = 1000
BACKUP_DIR = Path("/home/mitchlab/Documents")
OUTPUT_FILE = Path("pi_complet.txt")
PREVIEW_FILE = Path("pi_progress.txt")
CHECKPOINT_FILE = Path("pi_checkpoint.json")
LOG_FILE = Path("pi_calculate.log")
LOCK_FILE = Path("pi_calculate.lock")
HEARTBEAT_FILE = Path("calculator_heartbeat.json")

# Sources de snapshots locales supplementaires : les snapshots pi_N.txt generes
# par le site (pi.tmktools.com/data/) : seul le dernier palier (par million) est conserve.
ADDITIONAL_SNAPSHOT_DIRS = [SITE_DATA_DIR]
AUTHOR = "PI RasberryPi4"
ALGORITHM = "Chudnovsky (BigInt)"

# Destination distante pour l'upload automatique apres chaque palier
REMOTE_USER = "vote1550"
REMOTE_HOST = "109.234.165.174"
REMOTE_DIR = "/home/vote1550/pi.tmktools.com/data"
REMOTE_PATH = f"{REMOTE_DIR}/pi_complet.txt"
REMOTE_SCP_TARGET = f"{REMOTE_USER}@{REMOTE_HOST}:{REMOTE_PATH}"
REMOTE_CHECKPOINT_PATH = f"{REMOTE_DIR}/pi_checkpoint.json"
REMOTE_CHECKPOINT_SCP_TARGET = f"{REMOTE_USER}@{REMOTE_HOST}:{REMOTE_CHECKPOINT_PATH}"
REMOTE_CHECKPOINT_RESTORE_PATH = f"{REMOTE_DIR}/pi_checkpoint_restore.json"
REMOTE_HEARTBEAT_PATH = f"{REMOTE_DIR}/calculator_heartbeat.json"
REMOTE_HEARTBEAT_SCP_TARGET = f"{REMOTE_USER}@{REMOTE_HOST}:{REMOTE_HEARTBEAT_PATH}"
REMOTE_CHECKPOINT_HISTORY = 10
# Ignore une configuration SSH systeme invalide et interdit les demandes de mot de passe.
SSH_OPTIONS = ["-F", "/dev/null", "-o", "BatchMode=yes"]

C = 426880
K1 = 545140134
K2 = 13591409
K3 = 640320
K3_CUBE = K3 ** 3
DIGITS_PER_TERM = 14.1816474627
SAFETY_MARGIN = 5
EXTRA = 10
HEARTBEAT_INTERVAL_SECONDS = 60

# L'etat est mis a jour par le calcul principal et publie par un thread leger.
# Il permet au site de savoir que le calculateur tourne meme pendant l'evaluation
# longue d'un palier, lorsqu'aucun nouveau fichier pi_complet.txt n'est cree.
heartbeat_stop_event = threading.Event()
heartbeat_lock = threading.Lock()
heartbeat_state = {"stage": "initialisation", "digits_done": 0, "n": 0}


def update_heartbeat(stage: str, engine=None):
    with heartbeat_lock:
        heartbeat_state["stage"] = stage
        if engine is not None:
            heartbeat_state["digits_done"] = engine.digits_done
            heartbeat_state["n"] = engine.n


def upload_heartbeat() -> bool:
    """Publie atomiquement l'activite du calculateur sur le serveur de production."""
    try:
        with heartbeat_lock:
            payload = {
                "timestamp": datetime.datetime.now(datetime.timezone.utc).isoformat(),
                "pid": os.getpid(),
                **heartbeat_state,
            }
        tmp_local = HEARTBEAT_FILE.with_suffix(".json.tmp")
        tmp_local.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
        tmp_remote = REMOTE_HEARTBEAT_SCP_TARGET + ".tmp"
        copy_result = subprocess.run(
            ["scp", *SSH_OPTIONS, "-q", str(tmp_local), tmp_remote],
            capture_output=True,
            text=True,
            timeout=60,
        )
        if copy_result.returncode != 0:
            return False
        move_result = subprocess.run(
            ["ssh", *SSH_OPTIONS, f"{REMOTE_USER}@{REMOTE_HOST}",
             f"mv {REMOTE_HEARTBEAT_PATH}.tmp {REMOTE_HEARTBEAT_PATH}"],
            capture_output=True,
            text=True,
            timeout=30,
        )
        if move_result.returncode != 0:
            return False
        tmp_local.replace(HEARTBEAT_FILE)
        return True
    except Exception:
        return False


def heartbeat_loop():
    while not heartbeat_stop_event.wait(HEARTBEAT_INTERVAL_SECONDS):
        upload_heartbeat()


def isqrt(n: int) -> int:
    if n < 0:
        raise ValueError("isqrt() argument must be non-negative")
    if n == 0:
        return 0
    x = 1 << ((n.bit_length() + 1) // 2)
    while True:
        y = (x + n // x) // 2
        if y >= x:
            return x
        x = y


class ChudnovskyEngine:
    """
    Moteur incremental de Chudnovsky.

    Maintient l'etat sous la forme S_n = P_n / (-K3_CUBE)^n
    ou S_n = sum_{k=0}^{n-1} (-1)^k * M_k * L_k / (-K3_CUBE)^k.

    Attributs :
        n       : nombre de termes deja sommes
        P       : numerateur entier de S_n (denominateur = (-K3_CUBE)^n)
        M       : valeur de (6k)! / ((3k)! * (k!)^3) au terme n
        L       : valeur de K2 + K1 * k au terme n
        digits_done : dernier nombre de decimales valide ecrit
    """

    def __init__(self, n: int = 0, P: int = 0, M: int = 1, L: int = K2, digits_done: int = 0):
        self.n = n
        self.P = P
        self.M = M
        self.L = L
        self.digits_done = digits_done

    @classmethod
    def initial(cls):
        # n=0 : somme vide, S_0 = 0
        return cls(n=0, P=0, M=1, L=K2, digits_done=0)

    @classmethod
    def from_checkpoint(cls, path: Path):
        with open(path, "r", encoding="utf-8") as f:
            content = f.read().strip()
        if not content:
            raise ValueError(f"Checkpoint vide : {path}")
        data = json.loads(content)
        return cls(
            n=data["n"],
            P=data["P"],
            M=data["M"],
            L=data["L"],
            digits_done=data["digits_done"],
        )

    def to_dict(self):
        return {
            "version": 2,
            "n": self.n,
            "P": self.P,
            "M": self.M,
            "L": self.L,
            "digits_done": self.digits_done,
            "algorithm": ALGORITHM,
            "updated_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        }

    def save_checkpoint(self, path: Path):
        tmp_path = path.with_suffix(path.suffix + ".tmp")
        with open(tmp_path, "w", encoding="utf-8") as f:
            json.dump(self.to_dict(), f, indent=2)
            f.flush()
            os.fsync(f.fileno())
        tmp_path.replace(path)
        # Upload du checkpoint vers le serveur de production
        upload_remote_checkpoint(path)

    def estimate_digits(self) -> int:
        est = int(self.n * DIGITS_PER_TERM) - SAFETY_MARGIN
        return max(est, 0)

    def add_terms(self, m: int, progress_callback=None):
        """
        Ajoute m termes a la somme partielle, de k=n a k=n+m-1.
        Met a jour self.n, self.P, self.M, self.L.

        La somme partielle est maintenue sous la forme :
            S_n = P_n / (-K3_CUBE)^n
        avec P_n = sum_{k=0}^{n-1} (-1)^k * M_k * L_k * (-K3_CUBE)^{n-k}.

        Recurrence :
            P_{n+m} = (-K3_CUBE)^m * P_n + (-1)^m * S_part
        ou S_part = sum_{j=0}^{m-1} (-1)^j * M_{n+j} * L_{n+j} * K3_CUBE^{m-j}.
        """
        if m <= 0:
            return

        # Signe alterne a l'interieur du bloc de m termes
        sign = 1

        # D_current = K3_CUBE^{m-j} au fil des iterations
        D_current = K3_CUBE ** m

        S_part = 0
        M = self.M
        L = self.L

        for j in range(m):
            if j > 0:
                k = self.n + j
                M = M * 24 * (6 * k - 5) * (2 * k - 1) * (6 * k - 1) // (k ** 3)
                L += K1
                D_current //= K3_CUBE

            S_part += sign * M * L * D_current
            sign = -sign

            if progress_callback and j % 50 == 0:
                progress_callback(self.estimate_digits())

        # Mise a jour de l'etat
        self.P = self.P * ((-K3_CUBE) ** m) + ((-1) ** m) * S_part
        self.M = M
        self.L = L
        self.n += m


def evaluate_pi(engine: ChudnovskyEngine, digits: int) -> str:
    """
    Evalue π a `digits` decimales a partir de l'etat du moteur.
    """
    scale = 10 ** (digits + EXTRA)
    sqrt_10005 = isqrt(10005 * scale * scale)
    numerator = C * sqrt_10005

    # pi = C * sqrt(10005) / S_n
    #    = C * sqrt(10005) * (-K3_CUBE)^n / P_n
    # sqrt_10005 est deja multiplie par `scale`, donc le resultat est π * scale.
    pi_scaled = (numerator * ((-K3_CUBE) ** engine.n)) // engine.P
    pi_str = str(pi_scaled)[:-EXTRA]
    return f"{pi_str[0]}.{pi_str[1:]}"


def format_paris_timestamp(dt: datetime.datetime) -> str:
    """Formate un datetime en chaine ISO avec fuseau Europe/Paris et decalage correct."""
    dt_paris = dt.astimezone(TZ_PARIS)
    # Calcul du decalage UTC (evite les bugs de %z sur certaines versions de tzdata)
    offset = dt_paris.utcoffset()
    if offset is None:
        offset_formatted = "+00:00"
    else:
        total_seconds = int(offset.total_seconds())
        hours = total_seconds // 3600
        minutes = abs(total_seconds) % 3600 // 60
        offset_formatted = f"{hours:+03d}:{minutes:02d}"
    return dt_paris.strftime("%Y-%m-%dT%H:%M:%S.") + f"{dt_paris.microsecond // 1000:03d}{offset_formatted}"


def build_header(total_digits: int) -> str:
    now = datetime.datetime.now(datetime.timezone.utc)
    timestamp = format_paris_timestamp(now)
    return (
        f"# Pi Complet made with ♥ by {AUTHOR}\n"
        f"# Derniere mise a jour : {timestamp}\n"
        f"# Nombre total de decimales : {total_digits:,}\n"
        f"# Algorithme : {ALGORITHM}\n"
        f"#\n"
    )


def write_pi_file(pi_str: str, path: Path):
    total_digits = len(pi_str) - 2
    header = build_header(total_digits)
    with open(path, "w", encoding="utf-8") as f:
        f.write(header)
        f.write(pi_str)
        f.write("\n")


def write_preview(pi_str: str, digits_done: int):
    preview_len = min(len(pi_str), 2 + 50)
    preview = pi_str[:preview_len]
    with open(PREVIEW_FILE, "w", encoding="utf-8") as f:
        f.write(build_header(digits_done))
        f.write(preview)
        f.write("...\n")


def cleanup_old_backups(keep: int = 3):
    try:
        pattern = "pi_complet_backup_*.txt"
        backups = sorted(BACKUP_DIR.glob(pattern), key=lambda p: p.stat().st_mtime, reverse=True)
        for old in backups[keep:]:
            old.unlink()
            log_message(f"🗑️  Backup supprime (rotation) : {old.name}")
    except Exception as e:
        log_message(f"❌ [ERREUR ROTATION BACKUPS] {e}")


def upload_remote(src: Path) -> bool:
    """
    Upload le fichier src vers le serveur de production via scp, de maniere
    atomique (fichier temporaire puis mv). Retourne True si l'upload a reussi.
    """
    try:
        tmp_target = REMOTE_SCP_TARGET + ".tmp"
        tmp_path = REMOTE_PATH + ".tmp"
        expected_size = src.stat().st_size
        log_message(f"☁️  Envoi vers le serveur de production : {REMOTE_SCP_TARGET}")

        # 1) Transfert vers un fichier temporaire
        result = subprocess.run(
            ["scp", *SSH_OPTIONS, "-q", str(src), tmp_target],
            capture_output=True,
            text=True,
            timeout=300,
        )
        if result.returncode != 0:
            log_message(f"⚠️  [ERREUR UPLOAD PRODUCTION] scp code {result.returncode} : {result.stderr.strip()}")
            return False

        # 2) Verification de la taille du fichier temporaire
        result = subprocess.run(
            ["ssh", *SSH_OPTIONS, REMOTE_SCP_TARGET.rsplit(":", 1)[0],
             f"stat -c %s {tmp_path}"],
            capture_output=True,
            text=True,
            timeout=60,
        )
        if result.returncode != 0:
            log_message(f"⚠️  [ERREUR UPLOAD PRODUCTION] Impossible de verifier le temporaire : {result.stderr.strip()}")
            return False
        tmp_size = int(result.stdout.strip())
        if tmp_size != expected_size:
            log_message(f"⚠️  [ERREUR UPLOAD PRODUCTION] Taille temporaire incoherente : {tmp_size} != {expected_size}")
            return False

        # 3) Deplacement atomique vers la destination finale
        result = subprocess.run(
            ["ssh", *SSH_OPTIONS, REMOTE_SCP_TARGET.rsplit(":", 1)[0],
             f"mv {tmp_path} {REMOTE_PATH}"],
            capture_output=True,
            text=True,
            timeout=60,
        )
        if result.returncode != 0:
            log_message(f"⚠️  [ERREUR UPLOAD PRODUCTION] mv final a echoue : {result.stderr.strip()}")
            return False

        log_message(f"✅ Upload production reussi : {REMOTE_SCP_TARGET}")
        return True
    except subprocess.TimeoutExpired:
        log_message("⏱️  [ERREUR UPLOAD PRODUCTION] Timeout SCP (300s)")
        return False
    except Exception as e:
        log_message(f"❌ [ERREUR UPLOAD PRODUCTION] {e}")
        return False


def verify_remote_upload(expected_size: int) -> bool:
    """
    Verifie que le fichier distant a bien la taille attendue.
    """
    try:
        result = subprocess.run(
            ["ssh", *SSH_OPTIONS, REMOTE_SCP_TARGET.rsplit(":", 1)[0],
             f"stat -c %s {REMOTE_PATH}"],
            capture_output=True,
            text=True,
            timeout=60,
        )
        if result.returncode == 0:
            remote_size = int(result.stdout.strip())
            if remote_size == expected_size:
                log_message(f"🔍 Verification production OK : {remote_size} octets")
                return True
            else:
                log_message(f"⚠️  [VERIFICATION PRODUCTION] Taille incoherente : distante={remote_size}, attendue={expected_size}")
                return False
        else:
            log_message(f"⚠️  [VERIFICATION PRODUCTION] Impossible de lire la taille distante : {result.stderr.strip()}")
            return False
    except Exception as e:
        log_message(f"❌ [VERIFICATION PRODUCTION] {e}")
        return False


def deploy_to_production(src: Path) -> bool:
    """
    Upload le fichier vers le serveur de production et verifie la taille.
    Avant d'ecraser le fichier distant, verifie qu'il n'est pas PLUS AVANCE
    que le fichier local. Cela protege contre les demarrages accidentels a
    zero ou les regressions de checkpoint : un petit fichier local ne peut
    jamais ecraser un gros fichier distant.

    Retourne True si tout est OK (upload reussi ou distant deja plus avance).
    """
    local_digits = parse_digits_from_header(src)
    if local_digits is None:
        log_message("⚠️  [DEPLOY] Impossible de lire le nombre de decimales locales — upload annule")
        return False

    remote_digits = get_remote_digits_count(REMOTE_PATH)
    if remote_digits is not None and remote_digits >= local_digits:
        log_message(f"🛡️  [DEPLOY] Fichier distant plus avance ({remote_digits:,} >= {local_digits:,}) — upload skipped")
        log_message("   Le calculateur local continue d'avancer ; il uploadera quand il depassera le distant.")
        return True

    ok = upload_remote(src)
    if not ok:
        return False
    expected_size = src.stat().st_size
    return verify_remote_upload(expected_size)


def upload_remote_checkpoint(src: Path) -> bool:
    """
    Upload le checkpoint vers le serveur de production.
    Cree aussi une copie historisee (pi_checkpoint_YYYYMMDD_HHMMSS_digits.json)
    et conserve seulement les REMOTE_CHECKPOINT_HISTORY derniers historiques.
    """
    try:
        digits_done = 0
        try:
            data = json.loads(src.read_text(encoding="utf-8"))
            digits_done = int(data.get("digits_done", 0))
        except Exception:
            pass

        # Upload du checkpoint principal
        result = subprocess.run(
            ["scp", *SSH_OPTIONS, "-q", str(src), REMOTE_CHECKPOINT_SCP_TARGET],
            capture_output=True,
            text=True,
            timeout=300,
        )
        if result.returncode != 0:
            return False

        # Creer une copie historisee sur le serveur
        ts = datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%d_%H%M%S")
        history_name = f"pi_checkpoint_{ts}_{digits_done}dec.json"
        history_path = f"{REMOTE_DIR}/{history_name}"
        copy_result = subprocess.run(
            ["ssh", *SSH_OPTIONS, f"{REMOTE_USER}@{REMOTE_HOST}",
             f"cp {REMOTE_CHECKPOINT_PATH} {history_path}"],
            capture_output=True,
            text=True,
            timeout=60,
        )

        # Rotation : garder seulement les REMOTE_CHECKPOINT_HISTORY derniers
        if copy_result.returncode == 0 and REMOTE_CHECKPOINT_HISTORY > 0:
            rotate_result = subprocess.run(
                ["ssh", *SSH_OPTIONS, f"{REMOTE_USER}@{REMOTE_HOST}",
                 f"ls -t {REMOTE_DIR}/pi_checkpoint_*.json 2>/dev/null | tail -n +{REMOTE_CHECKPOINT_HISTORY + 1} | xargs -r rm -f"],
                capture_output=True,
                text=True,
                timeout=60,
            )
            # On ignore silencieusement les erreurs de rotation
            _ = rotate_result.returncode

        # Mettre a jour le checkpoint de restauration protégé si on a depasse
        # le meilleur restore existant. Cela garantit toujours un point de
        # reprise a la valeur maximale atteinte, meme si le checkpoint
        # principal est ecrase par une regression.
        try:
            restore_digits = get_remote_digits_count(REMOTE_CHECKPOINT_RESTORE_PATH)
            if restore_digits is None or digits_done > restore_digits:
                subprocess.run(
                    ["ssh", *SSH_OPTIONS, f"{REMOTE_USER}@{REMOTE_HOST}",
                     f"cp {REMOTE_CHECKPOINT_PATH} {REMOTE_CHECKPOINT_RESTORE_PATH}"],
                    capture_output=True,
                    text=True,
                    timeout=60,
                )
        except Exception:
            pass

        return True
    except Exception:
        return False


def download_remote_checkpoint(dst: Path) -> bool:
    """
    Telecharge le checkpoint principal du serveur de production.
    """
    return download_remote_file(REMOTE_CHECKPOINT_PATH, dst)


def parse_digits_from_header(path: Path) -> Optional[int]:
    """
    Lit l'en-tete d'un fichier π et extrait le nombre de decimales.
    Supporte les variantes avec/sans accent et les separateurs de milliers.
    Exemples :
      '# Nombre total de decimales : 162,672' -> 162672
      '# Nombre total de decimales : 200000'  -> 200000
    """
    try:
        with open(path, "r", encoding="utf-8") as f:
            for line in f:
                # Normalise pour ignorer les accents (e != e)
                normalized = unicodedata.normalize("NFKD", line).encode("ascii", "ignore").decode("ascii")
                lower = normalized.lower()
                if "nombre total de" in lower and "decimales" in lower:
                    digits_str = line.split(":")[-1].strip()
                    digits_str = digits_str.replace(" ", "").replace(",", "").replace(".", "")
                    return int(digits_str)
    except Exception:
        return None


def get_remote_file_size(remote_path: str) -> Optional[int]:
    """
    Recupere la taille d'un fichier distant via SSH.
    """
    try:
        result = subprocess.run(
            ["ssh", *SSH_OPTIONS, REMOTE_SCP_TARGET.rsplit(":", 1)[0],
             f"stat -c %s {remote_path}"],
            capture_output=True,
            text=True,
            timeout=60,
        )
        if result.returncode == 0:
            return int(result.stdout.strip())
    except Exception:
        return None
    return None


def get_remote_digits_count(remote_path: str) -> Optional[int]:
    """
    Lit l'en-tete d'un fichier π distant et retourne le nombre de decimales.
    Ne telecharge pas le fichier complet : uniquement les 20 premieres lignes.
    """
    try:
        target_host = REMOTE_SCP_TARGET.rsplit(":", 1)[0]
        result = subprocess.run(
            ["ssh", *SSH_OPTIONS, target_host,
             f"head -n 20 {remote_path}"],
            capture_output=True,
            text=True,
            timeout=60,
        )
        if result.returncode == 0:
            return parse_digits_from_header(result.stdout)
    except Exception:
        return None
    return None


def download_remote_file(remote_path: str, local_path: Path) -> bool:
    """
    Telecharge un fichier du serveur de production vers un chemin local.
    """
    try:
        target = f"{REMOTE_USER}@{REMOTE_HOST}:{remote_path}"
        result = subprocess.run(
            ["scp", *SSH_OPTIONS, "-q", target, str(local_path)],
            capture_output=True,
            text=True,
            timeout=300,
        )
        return result.returncode == 0
    except Exception:
        return False


def list_remote_txt_files() -> list[tuple[int, str]]:
    """
    Liste les fichiers .txt presents dans le dossier distant, avec leur taille,
    tries par taille decroissante.
    """
    try:
        remote_dir = REMOTE_PATH.rsplit("/", 1)[0]
        result = subprocess.run(
            ["ssh", *SSH_OPTIONS, f"{REMOTE_USER}@{REMOTE_HOST}",
             f"ls -l {remote_dir}/*.txt 2>/dev/null | awk '{{print $5, $NF}}'"],
            capture_output=True,
            text=True,
            timeout=60,
        )
        if result.returncode == 0:
            files = []
            for line in result.stdout.strip().splitlines():
                parts = line.strip().split(maxsplit=1)
                if len(parts) == 2:
                    try:
                        size = int(parts[0])
                        files.append((size, parts[1]))
                    except ValueError:
                        continue
            return sorted(files, reverse=True)
    except Exception:
        return []
    return []


def find_best_snapshot() -> tuple[Optional[Path], int]:
    """
    Cherche le meilleur snapshot disponible :
    1. Les plus gros fichiers .txt du dossier distant sur le serveur o2switch
    2. Backups locaux dans BACKUP_DIR
    3. Fichier local OUTPUT_FILE

    Retourne (chemin_du_fichier, nombre_de_decimales) ou (None, 0).
    """
    best_path: Optional[Path] = None
    best_digits = 0

    # 1. Snapshots distants (tries par taille decroissante)
    try:
        remote_files = list_remote_txt_files()
        for size, remote_file in remote_files:
            _ = size  # taille deja utilisee pour le tri
            tmp_remote = OUTPUT_FILE.with_suffix(f".remote_tmp_{Path(remote_file).name}")
            if download_remote_file(remote_file, tmp_remote):
                remote_digits = parse_digits_from_header(tmp_remote)
                if remote_digits and remote_digits > best_digits:
                    # Supprimer l'ancien meilleur snapshot distant temporaire
                    if best_path and str(best_path).endswith(".remote_tmp"):
                        try:
                            best_path.unlink()
                        except Exception:
                            pass
                    best_path = tmp_remote
                    best_digits = remote_digits
                else:
                    # Nettoyer le snapshot distant non retenu
                    try:
                        tmp_remote.unlink()
                    except Exception:
                        pass
    except Exception:
        pass

    # 2. Backups locaux
    try:
        for backup in sorted(BACKUP_DIR.glob("pi_complet_backup_*.txt"), key=lambda p: p.stat().st_mtime, reverse=True):
            digits = parse_digits_from_header(backup)
            if digits and digits > best_digits:
                best_path = backup
                best_digits = digits
    except Exception:
        pass

    # 3. Snapshots supplementaires locaux (ex: ../data/pi_18000000.txt)
    try:
        for snapshot_dir in ADDITIONAL_SNAPSHOT_DIRS:
            if not snapshot_dir.exists():
                continue
            for snapshot in sorted(snapshot_dir.glob("pi_*.txt"), key=lambda p: p.stat().st_mtime, reverse=True):
                digits = parse_digits_from_header(snapshot)
                if digits and digits > best_digits:
                    best_path = snapshot
                    best_digits = digits
    except Exception:
        pass

    # 4. Fichier local actuel
    if OUTPUT_FILE.exists():
        local_digits = parse_digits_from_header(OUTPUT_FILE)
        if local_digits and local_digits > best_digits:
            best_path = OUTPUT_FILE
            best_digits = local_digits

    return best_path, best_digits


def restore_checkpoint_from_snapshot(digits: int) -> ChudnovskyEngine:
    """
    Reconstruit un checkpoint valide au format v2 a partir du nombre de
    decimales d'un snapshot. Recalcule les termes Chudnovsky necessaires.

    La reconstruction est faite par blocs et un checkpoint intermediaire est
    sauvegarde tous les 5000 termes. Si le processus est interrompu, le
    prochain demarrage reprendra depuis le dernier checkpoint intermediaire.
    Un fichier .reconstructing est cree pour informer le watchdog que le
    processus est en pleine reconstruction et ne doit pas etre tue.
    """
    target_n = int(digits / DIGITS_PER_TERM) + 10
    RECONSTRUCTING_FILE = CHECKPOINT_FILE.with_suffix(".reconstructing")
    INTERMEDIATE_PREFIX = CHECKPOINT_FILE.with_suffix(".reconstruct_")

    # Signaler au watchdog qu'une longue reconstruction est en cours
    RECONSTRUCTING_FILE.write_text(str(target_n), encoding="utf-8")

    try:
        # Chercher un checkpoint intermediaire existant pour reprendre
        engine: Optional[ChudnovskyEngine] = None
        best_intermediate_n = -1
        for intermediate in Path(".").glob("pi_checkpoint.reconstruct_*.json"):
            try:
                candidate = ChudnovskyEngine.from_checkpoint(intermediate)
                if candidate.n <= target_n and candidate.n > best_intermediate_n:
                    engine = candidate
                    best_intermediate_n = candidate.n
            except Exception:
                continue

        if engine is not None:
            log_message(f"🔨 Reprise de la reconstruction depuis n={engine.n:,} / {target_n:,}")
        else:
            log_message(f"🔨 Reconstruction du checkpoint jusqu'a n={target_n:,} (snapshot {digits:,} decimales)...")
            engine = ChudnovskyEngine.initial()

        # Ajout par blocs de 1000 avec logging et checkpoints intermediaires
        block = 1000
        intermediate_block = 5000
        next_intermediate = ((engine.n // intermediate_block) + 1) * intermediate_block

        while engine.n < target_n:
            remaining = target_n - engine.n
            m = min(block, remaining)
            engine.add_terms(m)
            log_message(f"🔨   Checkpoint reconstruction : n={engine.n:,} / {target_n:,}")

            # Sauvegarde d'un checkpoint intermediaire tous les 5000 termes
            if engine.n >= next_intermediate:
                intermediate_path = CHECKPOINT_FILE.with_suffix(f".reconstruct_{engine.n:08d}.json")
                engine.save_checkpoint(intermediate_path)
                log_message(f"💾 Checkpoint intermediaire sauvegarde : {intermediate_path.name}")
                next_intermediate += intermediate_block

        engine.digits_done = digits
        engine.save_checkpoint(CHECKPOINT_FILE)
        log_message(f"✅ Checkpoint reconstruit : n={engine.n:,}, {engine.digits_done:,} decimales")
        return engine
    finally:
        # Nettoyer le fichier .reconstructing et les checkpoints intermediaires
        try:
            RECONSTRUCTING_FILE.unlink(missing_ok=True)
        except Exception:
            pass
        for intermediate in Path(".").glob("pi_checkpoint.reconstruct_*.json"):
            try:
                intermediate.unlink()
            except Exception:
                pass


def list_remote_checkpoints() -> list[tuple[int, str]]:
    """
    Liste les checkpoints historiques distants (pi_checkpoint_*.json)
    avec leur nombre de decimales, tries par digits decroissant.
    """
    try:
        result = subprocess.run(
            ["ssh", *SSH_OPTIONS, f"{REMOTE_USER}@{REMOTE_HOST}",
             f"ls -1 {REMOTE_DIR}/pi_checkpoint_*.json 2>/dev/null"],
            capture_output=True,
            text=True,
            timeout=60,
        )
        if result.returncode != 0:
            return []
        checkpoints = []
        for line in result.stdout.strip().splitlines():
            remote_file = line.strip()
            if not remote_file:
                continue
            # Le nom est de la forme pi_checkpoint_YYYYMMDD_HHMMSS_DDDDDDdec.json
            basename = remote_file.rsplit("/", 1)[-1]
            digits_part = basename.replace("pi_checkpoint_", "").replace(".json", "")
            # Extraire la partie _DDDdec
            if "dec" in digits_part:
                try:
                    digits_str = digits_part.rsplit("_", 1)[-1].replace("dec", "")
                    digits = int(digits_str)
                    checkpoints.append((digits, remote_file))
                except ValueError:
                    continue
        return sorted(checkpoints, reverse=True)
    except Exception:
        return []


def find_remote_checkpoint_for_snapshot(digits: int) -> Optional[str]:
    """
    Cherche un checkpoint distant (principal ou historique) avec au moins
    `digits` decimales. Retourne le chemin distant le plus adapte, ou None.
    """
    candidates = [(0, REMOTE_CHECKPOINT_PATH)]
    try:
        for hist_digits, hist_path in list_remote_checkpoints():
            candidates.append((hist_digits, hist_path))
    except Exception:
        pass

    best_path = None
    best_digits = 0
    for cand_digits, cand_path in candidates:
        if cand_digits >= digits and cand_digits > best_digits:
            best_path = cand_path
            best_digits = cand_digits
    return best_path


def read_remote_checkpoint_engine(remote_path: Optional[str] = None,
                                 tmp_suffix: str = ".remote_checkpoint_tmp") -> Optional[ChudnovskyEngine]:
    """
    Telecharge un checkpoint distant et retourne le moteur correspondant,
    SANS l'ecraser sur le disque local. Permet de tester/comparer avant de
    decider de remplacer le checkpoint local.
    """
    candidates: list[Optional[str]] = []
    if remote_path:
        candidates.append(remote_path)
    else:
        candidates.extend([
            REMOTE_CHECKPOINT_RESTORE_PATH,
            REMOTE_CHECKPOINT_PATH,
        ])
        try:
            for _digits, remote_file in list_remote_checkpoints():
                candidates.append(remote_file)
        except Exception:
            pass

    for path in candidates:
        if not path:
            continue
        try:
            tmp_checkpoint = CHECKPOINT_FILE.with_suffix(tmp_suffix)
            if download_remote_file(path, tmp_checkpoint):
                engine = ChudnovskyEngine.from_checkpoint(tmp_checkpoint)
                tmp_checkpoint.unlink(missing_ok=True)
                return engine
        except Exception:
            continue
    return None


def try_restore_from_remote_checkpoint(remote_path: Optional[str] = None) -> Optional[ChudnovskyEngine]:
    """
    Essaye de telecharger le checkpoint distant et de l'utiliser.
    Si `remote_path` est fourni, telecharge ce fichier specifique.
    Sinon essaie dans l'ordre :
      1. le checkpoint de restauration protégé (pi_checkpoint_restore.json)
      2. le checkpoint principal (pi_checkpoint.json)
      3. les checkpoints historiques
    Retourne le moteur restaure, ou None si impossible.
    """
    engine = read_remote_checkpoint_engine(remote_path)
    if engine is not None:
        # Sauvegarder definitivement le checkpoint local
        engine.save_checkpoint(CHECKPOINT_FILE)
        log_message(f"🔄 Checkpoint distant restaure : n={engine.n:,}, {engine.digits_done:,} decimales")
        return engine
    return None


def restore_from_snapshot_with_remote_fallback(snapshot_digits: int) -> ChudnovskyEngine:
    """
    Restaure le moteur a partir d'un snapshot .txt.
    Essaie d'abord d'utiliser un checkpoint distant avec au moins autant
    de decimales (evite une longue reconstruction). Sinon reconstruit le
    checkpoint localement avec des sauvegardes intermediaires.
    """
    remote_checkpoint = find_remote_checkpoint_for_snapshot(snapshot_digits)
    if remote_checkpoint:
        log_message(f"📸 Checkpoint distant adapte trouve : {remote_checkpoint.rsplit('/',1)[-1]}")
        engine = try_restore_from_remote_checkpoint(remote_checkpoint)
        if engine is not None:
            return engine
        log_message("⚠️  Echec de la restauration du checkpoint distant — reconstruction locale")

    return restore_checkpoint_from_snapshot(snapshot_digits)


def maybe_upgrade_engine_from_remote(engine: ChudnovskyEngine) -> ChudnovskyEngine:
    """
    Si un checkpoint distant PLUS AVANCE existe, le telecharger et remplacer
    le moteur local. Cela evite que le calculateur continue depuis un
    checkpoint local obsolete apres une restauration ou une copie erronee.
    Le checkpoint local NEST JAMAIS ecrase par un checkpoint distant moins
    avance.
    """
    try:
        remote_engine = read_remote_checkpoint_engine()
        if remote_engine is not None and remote_engine.digits_done > engine.digits_done:
            # On a verifie : le distant est strictement plus avance. On peut
            # maintenant l'adopter definitivement.
            remote_engine.save_checkpoint(CHECKPOINT_FILE)
            log_message(
                f"⬆️  Upgrade depuis le checkpoint distant : "
                f"{engine.digits_done:,} → {remote_engine.digits_done:,} decimales"
            )
            return remote_engine
        elif remote_engine is not None:
            log_message(
                f"🛡️  Checkpoint local conserve ({engine.digits_done:,} decimales) : "
                f"le distant ({remote_engine.digits_done:,}) n'est pas plus avance"
            )
    except Exception as e:
        log_message(f"⚠️  [UPGRADE DISTANT] {e}")
    return engine


def make_backup(src: Path, digits_done: int) -> Optional[Path]:
    try:
        if not BACKUP_DIR.exists():
            BACKUP_DIR.mkdir(parents=True, exist_ok=True)
        timestamp = datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%d_%H%M%S")
        backup_name = f"pi_complet_backup_{digits_done}dec_{timestamp}.txt"
        dst = BACKUP_DIR / backup_name
        shutil.copy2(src, dst)
        log_message(f"💾 Backup local cree : {dst.name}")
        cleanup_old_backups(keep=3)
        # Upload automatique vers le serveur de production
        deploy_to_production(src)
        return dst
    except Exception as e:
        log_message(f"❌ [ERREUR SAUVEGARDE] {e}")
        return None


class Logger:
    def __init__(self, path: Path):
        self.path = path

    def log(self, message: str):
        now = datetime.datetime.now(datetime.timezone.utc).astimezone(TZ_PARIS)
        timestamp = now.strftime("%Y-%m-%d %H:%M:%S %Z")
        line = f"[{timestamp}] {message}"
        # Ecriture dans le fichier log
        with open(self.path, "a", encoding="utf-8") as f:
            f.write(line + "\n")
            f.flush()
        # Affichage terminal uniquement si stdout est un TTY
        # (evite les doublons quand stdout est redirige dans un fichier)
        if sys.stdout.isatty():
            print(line, flush=True)


def log_message(message: str):
    logger.log(message)


class ProgressPrinter:
    """
    Affiche la progression sur stdout (terminal) sans polluer le fichier log.
    Les retours chariot (\\r) ne sont jamais ecrits dans log_message.
    """

    def __init__(self):
        self.last_msg_len = 0
        self.is_tty = sys.stdout.isatty()

    def update(self, message: str):
        if not self.is_tty:
            return
        sys.stdout.write("\r" + " " * self.last_msg_len + "\r")
        sys.stdout.write(message)
        sys.stdout.flush()
        self.last_msg_len = len(message)

    def clear(self):
        if not self.is_tty:
            return
        sys.stdout.write("\r" + " " * self.last_msg_len + "\r")
        sys.stdout.flush()
        self.last_msg_len = 0


def compute_palier(engine: ChudnovskyEngine, target_digits: int,
                   printer: ProgressPrinter, interrupted_ref: list) -> int:
    current_est = engine.estimate_digits()

    # Nombre de termes a ajouter pour atteindre la cible avec une petite marge
    n_needed = int(target_digits / DIGITS_PER_TERM) + 10 - engine.n
    m = max(0, n_needed)

    if m <= 0:
        return engine.estimate_digits()

    last_logged_est = -1

    def progress_callback(est):
        nonlocal last_logged_est
        if not interrupted_ref[0]:
            # Affichage ecran (une seule ligne, pas dans le fichier log)
            printer.update(f"🚀 {min(est, target_digits):>8} decimales atteintes (n={engine.n})")
            # Log fichier : uniquement quand l'estimation change de millier
            rounded = (min(est, target_digits) // 1000) * 1000
            if rounded != last_logged_est and rounded > 0:
                last_logged_est = rounded
                log_message(f"🚀 {min(est, target_digits):>8} decimales atteintes (n={engine.n})")

    log_message(f"🔢 Ajout de {m} termes Chudnovsky...")
    engine.add_terms(m, progress_callback=progress_callback)
    printer.clear()

    reached = engine.estimate_digits()
    if reached < target_digits and not interrupted_ref[0]:
        reached = target_digits
    return max(reached, engine.digits_done)


def main_loop(engine: ChudnovskyEngine, chunk_size: int,
              printer: ProgressPrinter, interrupted_ref: list,
              single_run_digits: Optional[int] = None):
    palier = 0
    while not interrupted_ref[0]:
        palier += 1
        if single_run_digits is not None:
            target_digits = single_run_digits
        else:
            target_digits = engine.digits_done + chunk_size

        log_message(f"\n📦 PALIER #{palier} — Cible : {target_digits} decimales")

        update_heartbeat("calcul des termes", engine)
        reached = compute_palier(engine, target_digits, printer, interrupted_ref)

        log_message(f"🧮 Evaluation de π a {reached} decimales...")
        update_heartbeat("evaluation de pi", engine)
        pi_str = evaluate_pi(engine, reached)
        actual_digits = len(pi_str) - 2
        engine.digits_done = actual_digits

        log_message(f"📝 Ecriture de {OUTPUT_FILE} ({actual_digits} decimales)")
        write_pi_file(pi_str, OUTPUT_FILE)
        write_preview(pi_str, actual_digits)

        log_message(f"💾 Sauvegarde du checkpoint : {CHECKPOINT_FILE}")
        update_heartbeat("sauvegarde du checkpoint", engine)
        engine.save_checkpoint(CHECKPOINT_FILE)

        update_heartbeat("upload du fichier", engine)
        backup = make_backup(OUTPUT_FILE, actual_digits)
        if backup:
            log_message(f"✅ Backup + upload production termines pour {actual_digits} decimales")

        log_message(f"🎯 Palier #{palier} termine : {actual_digits} decimales de π calculees")
        log_message(f"🔮 Apercu : {pi_str[:52]}...")

        if single_run_digits is not None:
            break

    if interrupted_ref[0]:
        printer.clear()
        log_message("\n🛑 Interruption detectee — sauvegarde finale en cours...")
        reached = engine.estimate_digits()
        reached = max(reached, engine.digits_done)
        pi_str = evaluate_pi(engine, reached)
        actual_digits = len(pi_str) - 2
        engine.digits_done = actual_digits

        log_message(f"📝 Ecriture finale de {OUTPUT_FILE}")
        write_pi_file(pi_str, OUTPUT_FILE)
        write_preview(pi_str, actual_digits)
        engine.save_checkpoint(CHECKPOINT_FILE)
        backup = make_backup(OUTPUT_FILE, actual_digits)
        if backup:
            log_message(f"✅ Backup final + upload production termines")
        log_message(f"🔄 Etat sauvegarde a {actual_digits} decimales. Relance possible.")


def parse_args():
    parser = argparse.ArgumentParser(
        description="Calcul de π par Chudnovsky (BigInt), mode infini par defaut."
    )
    parser.add_argument("--digits", type=int, default=None,
                        help="Mode fini : calcule exactement N decimales puis s'arrete.")
    parser.add_argument("--chunk", type=int, default=CHUNK_SIZE,
                        help="Taille d'un palier de sauvegarde (defaut : 1000).")
    parser.add_argument("--reset", action="store_true",
                        help="Supprime le checkpoint existant et recommence a zero.")
    parser.add_argument("--no-resume", action="store_true",
                        help="Ne pas reprendre le checkpoint existant (mais ne le supprime pas).")
    return parser.parse_args()


def acquire_lock() -> bool:
    """
    Cree le fichier de lock. Si un lock existe deja :
    - Si le PID est actif, on refuse (une instance tourne deja).
    - Si le PID est mort, on supprime le lock obsolete et on continue.
    """
    try:
        if LOCK_FILE.exists():
            try:
                pid = int(LOCK_FILE.read_text(encoding="utf-8").strip())
                current_pid = os.getpid()
                if pid == current_pid:
                    return True
                try:
                    os.kill(pid, 0)
                    print(f"🔒 Une autre instance de calculate_pi.py est deja en cours (PID={pid}).", file=sys.stderr)
                    return False
                except ProcessLookupError:
                    # PID mort, on nettoie le lock obsolete
                    LOCK_FILE.unlink()
                    print(f"🧹 Lock obsolete (PID={pid} mort) supprime.", file=sys.stderr)
            except (ValueError, OSError):
                # Lock illisible, on le supprime
                LOCK_FILE.unlink()
        LOCK_FILE.write_text(str(os.getpid()), encoding="utf-8")
        return True
    except Exception as e:
        print(f"❌ [ERREUR LOCK] {e}", file=sys.stderr)
        return False


def release_lock():
    try:
        if LOCK_FILE.exists():
            try:
                pid = int(LOCK_FILE.read_text(encoding="utf-8").strip())
                if pid == os.getpid():
                    LOCK_FILE.unlink()
            except (ValueError, OSError):
                LOCK_FILE.unlink()
    except Exception:
        pass


def main():
    if not acquire_lock():
        print("🔒 Une autre instance de calculate_pi.py est deja en cours.", file=sys.stderr)
        print("   Utilisez : kill \"$(cat pi_calculate.pid)\"", file=sys.stderr)
        sys.exit(1)

    try:
        global logger
        logger = Logger(LOG_FILE)

        args = parse_args()
        chunk_size = max(args.chunk, 1)

        interrupted_ref = [False]

        def signal_handler(signum, frame):
            interrupted_ref[0] = True
            log_message(f"🛑 Signal {signum} recu — arret propre en cours...")

        if hasattr(signal, "SIGINT"):
            signal.signal(signal.SIGINT, signal_handler)
        if hasattr(signal, "SIGTERM"):
            signal.signal(signal.SIGTERM, signal_handler)

        log_message("=" * 60)
        log_message("🥧 Calcul de π — Algorithme de Chudnovsky (BigInt)")
        if args.digits:
            log_message(f"📏 Mode FINI : {args.digits:,} decimales")
        else:
            log_message("♾️  Mode INFINI : calcul jusqu'a interruption manuelle")
        log_message(f"📦 Palier de sauvegarde : {chunk_size:,} decimales")
        log_message(f"💾 Backups locaux : {BACKUP_DIR}")
        log_message(f"🌐 Serveur de production : {REMOTE_SCP_TARGET}")
        log_message("=" * 60)

        if args.reset and CHECKPOINT_FILE.exists():
            CHECKPOINT_FILE.unlink()
            log_message("🗑️  Checkpoint supprime (reset demande)")

        if args.no_resume or not CHECKPOINT_FILE.exists():
            # Si pas de checkpoint valide, essayer d'abord le checkpoint distant,
            # puis chercher un snapshot .txt de secours.
            engine = try_restore_from_remote_checkpoint()
            if engine is None:
                snapshot_path, snapshot_digits = find_best_snapshot()
                if snapshot_path and snapshot_digits > 0:
                    log_message(f"📸 Snapshot de secours trouve : {snapshot_digits:,} decimales")
                    if snapshot_path != OUTPUT_FILE:
                        shutil.copy2(snapshot_path, OUTPUT_FILE)
                        log_message(f"📝 Fichier principal restaure depuis le snapshot")
                    for tmp in Path(".").glob("*.remote_tmp_*"):
                        try:
                            tmp.unlink()
                        except Exception:
                            pass
                    engine = restore_from_snapshot_with_remote_fallback(snapshot_digits)
                    log_message(f"🔄 Reprise depuis le snapshot : {snapshot_digits:,} decimales, n={engine.n:,}")
                else:
                    engine = ChudnovskyEngine.initial()
                    log_message("🚀 Demarrage depuis zero")
        else:
            try:
                engine = ChudnovskyEngine.from_checkpoint(CHECKPOINT_FILE)
                log_message(f"🔄 Reprise du checkpoint : n={engine.n:,}, {engine.digits_done:,} decimales deja validees")
                # Si un checkpoint distant plus avance existe, le prendre pour eviter
                # une regression silencieuse (ex. Raspberry redemarre avec un vieux checkpoint).
                engine = maybe_upgrade_engine_from_remote(engine)
            except Exception as e:
                log_message(f"⚠️  Checkpoint local invalide ou vide ({e}) — recherche d'un secours")
                engine = try_restore_from_remote_checkpoint()
                if engine is None:
                    snapshot_path, snapshot_digits = find_best_snapshot()
                    if snapshot_path and snapshot_digits > 0:
                        log_message(f"📸 Snapshot de secours trouve : {snapshot_digits:,} decimales")
                        if snapshot_path != OUTPUT_FILE:
                            shutil.copy2(snapshot_path, OUTPUT_FILE)
                            log_message(f"📝 Fichier principal restaure depuis le snapshot")
                        for tmp in Path(".").glob("*.remote_tmp_*"):
                            try:
                                tmp.unlink()
                            except Exception:
                                pass
                        engine = restore_checkpoint_from_snapshot(snapshot_digits)
                        log_message(f"🔄 Reprise depuis le snapshot : {snapshot_digits:,} decimales, n={engine.n:,}")
                    else:
                        engine = ChudnovskyEngine.initial()
                        log_message("🚀 Aucun snapshot disponible — demarrage depuis zero")

        printer = ProgressPrinter()
        update_heartbeat("calculateur actif", engine)
        upload_heartbeat()
        heartbeat_thread = threading.Thread(target=heartbeat_loop, name="calculator-heartbeat", daemon=True)
        heartbeat_thread.start()

        try:
            main_loop(engine, chunk_size, printer, interrupted_ref, single_run_digits=args.digits)
        except Exception as e:
            log_message(f"❌ [ERREUR FATALE] {e}")
            try:
                engine.save_checkpoint(CHECKPOINT_FILE)
                log_message("🆘 Checkpoint d'urgence sauvegarde")
            except Exception:
                pass
            raise

        printer.clear()
        log_message("=" * 60)
        if args.digits:
            log_message("✅ Calcul fini termine")
        else:
            log_message("🛑 Calcul interrompu ou termine")
        log_message(f"📄 Fichier principal : {OUTPUT_FILE.resolve()}")
        log_message(f"💾 Checkpoint        : {CHECKPOINT_FILE.resolve()}")
        log_message(f"📊 Total decimales   : {engine.digits_done:,}")
        log_message("=" * 60)
    finally:
        heartbeat_stop_event.set()
        update_heartbeat("calculateur arrete")
        upload_heartbeat()
        release_lock()


if __name__ == "__main__":
    main()
