#!/usr/bin/env python3
"""
Point d'entrée du calculateur de décimales de π.

Exemples :
    python main.py
    python main.py --decimals 500 --output pi_500.txt --chunk 20
"""

import click
from pi_calculator import compute_pi, get_decimal_ranks
from rich.panel import Panel
from display import print_header, print_table, print_stats, console
from file_manager import save_pi


@click.command()
@click.option(
    "--decimals", "-d",
    default=100,
    show_default=True,
    help="Nombre de décimales de π à calculer.",
)
@click.option(
    "--output", "-o",
    default="pi_decimals.txt",
    show_default=True,
    help="Chemin du fichier texte de sortie.",
)
@click.option(
    "--chunk", "-c",
    default=10,
    show_default=True,
    help="Nombre de décimales par bloc dans le tableau.",
)
@click.option(
    "--no-table", is_flag=True,
    help="Désactive l'affichage tabulaire (affichage simple uniquement).",
)
def main(decimals: int, output: str, chunk: int, no_table: bool) -> None:
    """Calcule π avec une précision donnée, affiche les résultats et les sauvegarde."""
    if decimals < 1:
        console.print("[bold red]Erreur :[/] Le nombre de décimales doit être ≥ 1.")
        raise click.Exit(1)
    if chunk < 1:
        console.print("[bold red]Erreur :[/] La taille de bloc doit être ≥ 1.")
        raise click.Exit(1)

    print_header(decimals)

    with console.status("[bold green]Calcul des décimales de π en cours...", spinner="dots"):
        pi_str = compute_pi(decimals)

    # Extraction des rangs et valeurs
    ranks = get_decimal_ranks(pi_str)

    # Affichage du résultat
    if no_table:
        console.print(f"[bold bright_white]π = [/][bright_green]{pi_str[:50]}...[/]\n")
    else:
        print_table(ranks, chunk_size=chunk)

    # Sauvegarde
    with console.status(f"[bold yellow]Écriture dans {output}...", spinner="line"):
        save_pi(pi_str, output)

    # Statistiques finales
    print_stats(pi_str, output)

    # Petit aperçu complet en fin de sortie
    preview_len = min(decimals, 200)
    preview = pi_str[:preview_len + 2]  # +2 pour '3.'
    if decimals > preview_len:
        preview += "..."
    console.print(Panel(
        f"[bright_green]{preview}[/]",
        title="[bold bright_white]Aperçu complet[/]",
        border_style="bright_magenta",
    ))


if __name__ == "__main__":
    main()
