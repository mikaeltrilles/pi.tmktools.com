#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Calcul de π par l'algorithme de Chudnovsky en arithmetique entiere (BigInt).

Mode principal : calcul NON BORNE (infini) par paliers de 1000 decimales.
- Le programme tourne en boucle jusqu'a interruption manuelle.
- Chaque palier termine, le fichier pi_complet.txt est mis a jour.
- Une copie de sauvegarde est effectuee dans /home/mika/Documents.
- Seuls les 3 derniers backups sont conserves (rotation automatique).
- L'etat du calcul est sauvegarde dans pi_checkpoint.json apres chaque palier,
  ce qui permet de reprendre exactement la ou le programme s'est arrete.
- Le fichier pi_complet.txt est upload automatiquement par SCP vers le serveur
  de production apres chaque palier.

Algorithme incremental : on maintient la somme partielle sous la forme
S_n = P_n / (-640320^3)^n, ce qui permet d'ajouter des termes par blocs sans
recalculer la serie depuis le debut a chaque palier.

Auteur : PI RasberryPi4
"""

import os
import sys
import shutil
import signal
import json
import datetime
import argparse
import subprocess
from pathlib import Path
from typing import Optional

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

if hasattr(sys, "set_int_max_str_digits"):
    sys.set_int_max_str_digits(0)

CHUNK_SIZE = 1000
BACKUP_DIR = Path("/home/mika/Documents")
OUTPUT_FILE = Path("pi_complet.txt")
PREVIEW_FILE = Path("pi_progress.txt")
CHECKPOINT_FILE = Path("pi_checkpoint.json")
LOG_FILE = Path("pi_calculate.log")
LOCK_FILE = Path("pi_calculate.lock")
AUTHOR = "PI RasberryPi4"
ALGORITHM = "Chudnovsky (BigInt)"

# Destination distante pour l'upload automatique apres chaque palier
REMOTE_USER = "vote1550"
REMOTE_HOST = "109.234.165.174"
REMOTE_PATH = "/home/vote1550/pi.tmktools.com/data/pi_complet.txt"
REMOTE_SCP_TARGET = f"{REMOTE_USER}@{REMOTE_HOST}:{REMOTE_PATH}"

C = 426880
K1 = 545140134
K2 = 13591409
K3 = 640320
K3_CUBE = K3 ** 3
DIGITS_PER_TERM = 14.1816474627
SAFETY_MARGIN = 5
EXTRA = 10


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
            data = json.load(f)
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
        with open(path, "w", encoding="utf-8") as f:
            json.dump(self.to_dict(), f, indent=2)

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

        Pour ajouter m termes :
            P_{n+m} = (-K3_CUBE)^m * P_n + S_part
        ou S_part = (-1)^{n+m} * sum_{j=0}^{m-1} M_{n+j} * L_{n+j} * K3_CUBE^{m-j}.
        """
        if m <= 0:
            return

        # Signe constant pour tous les nouveaux termes : (-1)^(n+m)
        sign = 1 if (self.n + m) % 2 == 0 else -1

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

            if progress_callback and j % 50 == 0:
                progress_callback(self.estimate_digits())

        # Mise a jour de l'etat
        self.P = self.P * ((-K3_CUBE) ** m) + S_part
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
    # Le signe de (-K3_CUBE)^n est géré automatiquement par l'exponentiation.
    pi_scaled = (numerator * scale * ((-K3_CUBE) ** engine.n)) // engine.P
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
    preview_len = min(len(pi_str), digits_done + 2 + 50)
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
    Upload le fichier src vers le serveur de production via scp.
    Retourne True si l'upload a reussi.
    """
    try:
        log_message(f"☁️  Envoi vers le serveur de production : {REMOTE_SCP_TARGET}")
        result = subprocess.run(
            ["scp", "-q", str(src), REMOTE_SCP_TARGET],
            capture_output=True,
            text=True,
            timeout=300,
        )
        if result.returncode == 0:
            log_message(f"✅ Upload production reussi : {REMOTE_SCP_TARGET}")
            return True
        else:
            log_message(f"⚠️  [ERREUR UPLOAD PRODUCTION] scp code {result.returncode} : {result.stderr.strip()}")
            return False
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
            ["ssh", "-o", "BatchMode=yes", REMOTE_SCP_TARGET.rsplit(":", 1)[0],
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
    Retourne True si tout est OK.
    """
    ok = upload_remote(src)
    if not ok:
        return False
    expected_size = src.stat().st_size
    return verify_remote_upload(expected_size)


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

        reached = compute_palier(engine, target_digits, printer, interrupted_ref)

        log_message(f"🧮 Evaluation de π a {reached} decimales...")
        pi_str = evaluate_pi(engine, reached)
        actual_digits = len(pi_str) - 2
        engine.digits_done = actual_digits

        log_message(f"📝 Ecriture de {OUTPUT_FILE} ({actual_digits} decimales)")
        write_pi_file(pi_str, OUTPUT_FILE)
        write_preview(pi_str, actual_digits)

        log_message(f"💾 Sauvegarde du checkpoint : {CHECKPOINT_FILE}")
        engine.save_checkpoint(CHECKPOINT_FILE)

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
            engine = ChudnovskyEngine.initial()
            log_message("🚀 Demarrage depuis zero")
        else:
            engine = ChudnovskyEngine.from_checkpoint(CHECKPOINT_FILE)
            log_message(f"🔄 Reprise du checkpoint : n={engine.n:,}, {engine.digits_done:,} decimales deja validees")

        printer = ProgressPrinter()

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
        release_lock()


if __name__ == "__main__":
    main()
