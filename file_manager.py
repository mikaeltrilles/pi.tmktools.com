"""
Gestion de la persistance des décimales de π.
"""

from pathlib import Path
from typing import List, Tuple


def save_pi(pi_str: str, filepath: str) -> None:
    """
    Écrit la chaîne complète de π dans un fichier texte.
    Format : 3.141592653589793...
    """
    path = Path(filepath)
    path.write_text(pi_str + "\n", encoding="utf-8")


def save_ranks(decimals: List[Tuple[int, int]], filepath: str) -> None:
    """
    (Optionnel) Écrit les rangs et décimales dans un fichier CSV-like.
    """
    path = Path(filepath)
    lines = ["rang,decimale\n"]
    lines += [f"{rank},{value}\n" for rank, value in decimals]
    # On écrit à côté du fichier principal
    ranks_path = path.with_suffix(".csv")
    ranks_path.write_text("".join(lines), encoding="utf-8")
