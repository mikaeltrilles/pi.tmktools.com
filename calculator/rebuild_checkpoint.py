#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Utilitaire de reconstruction du checkpoint Chudnovsky.

Usage:
    python3 rebuild_checkpoint.py --digits 4673798

Recalcule a_k et s jusqu'au terme k correspondant aux digits demandes
et ecrit un fichier pi_checkpoint.json valide.
"""

import sys
import json
import datetime
import argparse
from pathlib import Path

if hasattr(sys, "set_int_max_str_digits"):
    sys.set_int_max_str_digits(0)

C = 426880
K1 = 545140134
K2 = 13591409
K3 = 640320
K3_CUBE = K3 ** 3
DIGITS_PER_TERM = 14.1816474627
SAFETY_MARGIN = 5

ALGORITHM = "Chudnovsky (BigInt)"
CHECKPOINT_FILE = Path(__file__).resolve().parent / "pi_checkpoint.json"


def rebuild(digits: int):
    target_k = int(digits / DIGITS_PER_TERM) + 10
    safety_target_k = max(0, int((digits + SAFETY_MARGIN) / DIGITS_PER_TERM))

    print(f"Reconstruction du checkpoint jusqu'a {digits} decimales...")
    print(f"Terme cible k ~ {safety_target_k}, on calcule jusqu'a k = {target_k}")

    a_k = 1
    s = K2

    for k in range(1, target_k + 1):
        a_k *= (6 * k - 5) * (2 * k - 1) * (6 * k - 1)
        a_k //= k * k * k
        a_k //= K3_CUBE

        term = a_k * (K2 + K1 * k)
        if k % 2 == 0:
            s += term
        else:
            s -= term

        if k % 1000 == 0:
            est = int(k * DIGITS_PER_TERM) - SAFETY_MARGIN
            print(f"  k={k} -> ~{max(est, 0)} decimales")

    data = {
        "version": 1,
        "k": target_k,
        "a_k": a_k,
        "s": s,
        "digits_done": digits,
        "algorithm": ALGORITHM,
        "updated_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
    }

    with open(CHECKPOINT_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)

    print(f"Checkpoint reconstruit : k={target_k}, digits_done={digits}")
    print(f"Fichier sauvegarde : {CHECKPOINT_FILE.resolve()}")


def main():
    parser = argparse.ArgumentParser(description="Reconstruire le checkpoint Chudnovsky")
    parser.add_argument("--digits", type=int, required=True,
                        help="Nombre de decimales deja atteint dans le fichier π")
    args = parser.parse_args()
    rebuild(args.digits)


if __name__ == "__main__":
    main()
