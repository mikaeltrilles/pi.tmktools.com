"""
Calculateur de décimales de π via la formule de Machin et le module decimal.

La formule de Machin :
    π/4 = 4·arctan(1/5) − arctan(1/239)

Chaque arctan est évalué par sa série de Taylor :
    arctan(x) = x − x³/3 + x⁵/5 − x⁷/7 + ...
"""

from decimal import Decimal, getcontext
from typing import List, Tuple


def _arctan_machin(x: Decimal, extra_prec: int = 10) -> Decimal:
    """
    Calcule arctan(x) par la série de Taylor avec haute précision.
    """
    # Augmente la précision interne pour éviter les erreurs d'arrondi cumulées
    getcontext().prec += extra_prec

    result = Decimal(0)
    x_power = x
    sign = 1
    n = 1
    zero = Decimal(0)
    epsilon = Decimal(10) ** (-(getcontext().prec - extra_prec))

    while True:
        term = x_power / n
        if term.copy_abs() < epsilon:
            break
        result += sign * term
        x_power *= x * x
        n += 2
        sign *= -1

    getcontext().prec -= extra_prec
    return +result  # le + force l'arrondi à la précision courante


def compute_pi(n: int) -> str:
    """
    Calcule π avec n décimales après la virgule.
    Retourne une chaîne de la forme '3.1415926535...'.
    """
    if n < 1:
        return "3."

    # Précision interne : nombre de chiffres + marge de sécurité
    getcontext().prec = n + 10

    # Termes de la formule de Machin
    atan_1_5 = _arctan_machin(Decimal(1) / Decimal(5))
    atan_1_239 = _arctan_machin(Decimal(1) / Decimal(239))

    pi = 4 * (4 * atan_1_5 - atan_1_239)

    # Réduit la précision pour l'affichage final
    getcontext().prec = n + 2
    pi = +pi

    # Conversion en chaîne avec la précision exacte demandée
    pi_str = str(pi)

    # S'assure que l'on a bien '3.' suivi d'au moins n décimales
    if "." not in pi_str:
        pi_str += "."
    integer_part, _, decimal_part = pi_str.partition(".")
    decimal_part = (decimal_part + "0" * n)[:n]
    return f"{integer_part}.{decimal_part}"


def get_decimal_ranks(pi_str: str) -> List[Tuple[int, int]]:
    """
    Retourne une liste de tuples (rang, decimale) pour chaque décimale après la virgule.
    Le rang commence à 1.
    """
    decimals = pi_str.split(".")[1]
    return [(i + 1, int(ch)) for i, ch in enumerate(decimals)]
