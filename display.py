"""
Gestion de l'affichage professionnel avec Rich.
"""

from typing import List, Tuple
from rich.console import Console
from rich.table import Table
from rich.panel import Panel
from rich.columns import Columns
from rich.text import Text
from rich import box

console = Console()


def print_header(n: int) -> None:
    """Affiche un en-tête stylisé."""
    title = Text("π  Calculateur de Décimales", style="bold bright_white", justify="center")
    subtitle = Text(f"Précision demandée : {n} décimales", style="italic bright_cyan", justify="center")
    console.print()
    console.print(Panel.fit(
        Text.assemble(title, "\n", subtitle),
        border_style="bright_blue",
        padding=(1, 4),
    ))
    console.print()


def print_table(decimals: List[Tuple[int, int]], chunk_size: int = 10) -> None:
    """
    Affiche les décimales sous forme de tableau professionnel.
    Colonnes : Rang, Valeur, Bloc.
    """
    table = Table(
        title="[bold bright_white]Répartition des décimales[/]",
        caption="[dim]Formule de Machin — Série de Taylor (decimal)[/]",
        box=box.ROUNDED,
        show_header=True,
        header_style="bold bright_magenta",
        row_styles=["none", "dim"],
        border_style="bright_blue",
    )

    table.add_column("Bloc", justify="center", style="bright_cyan", width=10)
    table.add_column("Rangs", justify="right", style="bright_white", min_width=20)
    table.add_column("Valeurs", justify="left", style="bold bright_green", min_width=20)

    # Groupement par blocs
    for start in range(0, len(decimals), chunk_size):
        bloc_num = start // chunk_size + 1
        chunk = decimals[start:start + chunk_size]
        rangs = " ".join(str(r) for r, _ in chunk)
        vals = " ".join(str(v) for _, v in chunk)
        table.add_row(f"#{bloc_num}", rangs, vals)

    console.print(table)
    console.print()


def print_stats(pi_str: str, filepath: str) -> None:
    """Affiche des statistiques et le chemin du fichier."""
    decimals = pi_str.split(".")[1]
    stats = Text.assemble(
        ("• Partie entière : ", "bright_white"),
        ("3\n", "bold bright_green"),
        ("• Nombre de décimales : ", "bright_white"),
        (f"{len(decimals)}\n", "bold bright_green"),
        ("• Fichier de sortie : ", "bright_white"),
        (filepath, "bold underline bright_yellow"),
    )
    console.print(Panel(stats, title="[bold bright_white]Statistiques[/]", border_style="bright_green"))
    console.print()
