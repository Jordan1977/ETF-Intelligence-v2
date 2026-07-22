"""
build_dashboard_data.py

Compiles the static/reference JSON files consumed by the dashboard from
human-edited source CSVs. This script needs NO network access, so it can
never fail because of a market-data outage. Run this whenever you edit
the *_source.csv files (new ETF, new competitor, new allocation profile).

Network-dependent files (market_data.json, and the computed metrics inside
etf_universe.json) are produced separately by update_market_data.py and
compute_etf_metrics.py, which are allowed to fail gracefully.

Usage:
    python scripts/build_dashboard_data.py
"""
from __future__ import annotations

import json
import math
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"

TODAY = datetime.now(timezone.utc).strftime("%Y-%m-%d")


def log(msg: str) -> None:
    print(f"[build_dashboard_data] {msg}", flush=True)


def clean_json(obj):
    """Recursively replace NaN/Inf and numpy scalars with JSON-safe values."""
    if isinstance(obj, dict):
        return {k: clean_json(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [clean_json(v) for v in obj]
    if isinstance(obj, float):
        if math.isnan(obj) or math.isinf(obj):
            return None
        return obj
    if hasattr(obj, "item"):  # numpy scalar
        return clean_json(obj.item())
    return obj


def write_json(name: str, payload: dict) -> None:
    payload = clean_json(payload)
    path = DATA / name
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    log(f"wrote {path.relative_to(ROOT)}")


# ---------------------------------------------------------------------------
# ETF universe
# ---------------------------------------------------------------------------
def build_etf_universe() -> None:
    df = pd.read_csv(DATA / "etf_universe_source.csv")
    df = df.where(pd.notnull(df), None)

    records = []
    for _, row in df.iterrows():
        records.append({
            "ticker": row["ticker"],
            "name": row["name"],
            "isin": row["isin"],
            "provider": row["provider"],
            "category": row["category"],
            "peer_group": row["peer_group"],
            "benchmark": {
                "name": row["benchmark_name"],
                "proxy_ticker": row["benchmark_ticker"] if row["benchmark_ticker"] != "n/a" else None,
            },
            "currency": row["currency"],
            "ter": {
                "value": float(row["ter"]) if row["ter"] is not None else None,
                "status": row["ter_status"],
            },
            "aum_eur": {
                "value": row["aum_eur"],
                "status": row["aum_status"],
            },
            "launch_date": row["launch_date"],
            "replication": row["replication"],
            "distribution_policy": row["distribution_policy"],
            "domicile": row["domicile"],
            "pea_eligible": row["pea_eligible"],
            "sfdr": row["sfdr"],
            "esg_strategy": row["esg_strategy"],
            "source_url": row["source_url"],
            "last_verified": row["last_verified"],
            "verification_status": row["verification_status"],
            # Filled in later by compute_etf_metrics.py; kept here so the
            # front-end always finds the keys even before the network step runs.
            "metrics": {
                "status": "not_computed",
                "as_of": None,
                "return_1y": None,
                "volatility_1y": None,
                "max_drawdown_1y": None,
                "sharpe_1y": None,
                "tracking_difference_1y": None,
                "tracking_error_1y": None,
            },
        })

    write_json("etf_universe.json", {
        "generated_at": TODAY,
        "count": len(records),
        "disclaimer": (
            "Univers demonstratif construit a partir de sources publiques. "
            "Ne reproduit pas la composition reelle des portefeuilles Yomoni."
        ),
        "etfs": records,
    })


# ---------------------------------------------------------------------------
# Competitors
# ---------------------------------------------------------------------------
def build_competitors() -> None:
    df = pd.read_csv(DATA / "competitors_source.csv")
    df = df.where(pd.notnull(df), None)
    records = df.to_dict(orient="records")
    write_json("competitors.json", {
        "generated_at": TODAY,
        "disclaimer": "Positionnements publics uniquement ; ne compare pas des performances de profils non comparables.",
        "competitors": records,
    })


# ---------------------------------------------------------------------------
# Allocations (illustrative model portfolios)
# ---------------------------------------------------------------------------
def build_allocations() -> None:
    profiles = [
        {
            "id": "prudent",
            "name": "Profil Prudent",
            "target_weights": {"Actions Monde": 15, "Actions Etats-Unis": 5, "Europe": 5,
                                "Marches Emergents": 0, "Obligations": 65, "Diversifiants": 10},
            "rebalance_band_pct": 3,
        },
        {
            "id": "equilibre",
            "name": "Profil Equilibre",
            "target_weights": {"Actions Monde": 30, "Actions Etats-Unis": 10, "Europe": 10,
                                "Marches Emergents": 5, "Obligations": 38, "Diversifiants": 7},
            "rebalance_band_pct": 4,
        },
        {
            "id": "dynamique",
            "name": "Profil Dynamique",
            "target_weights": {"Actions Monde": 45, "Actions Etats-Unis": 15, "Europe": 10,
                                "Marches Emergents": 10, "Obligations": 15, "Diversifiants": 5},
            "rebalance_band_pct": 5,
        },
        {
            "id": "responsable",
            "name": "Profil Responsable (ESG)",
            "target_weights": {"Actions Monde": 25, "Actions Etats-Unis": 10, "Europe ESG": 15,
                                "Marches Emergents": 5, "Obligations": 38, "Diversifiants": 7},
            "rebalance_band_pct": 4,
            "note": "Poches ESG uniquement (Screened / Selection / SRI selon disponibilite).",
        },
        {
            "id": "100_actions",
            "name": "Profil 100% Actions",
            "target_weights": {"Actions Monde": 55, "Actions Etats-Unis": 20, "Europe": 15,
                                "Marches Emergents": 10, "Obligations": 0, "Diversifiants": 0},
            "rebalance_band_pct": 5,
        },
    ]
    write_json("allocations.json", {
        "generated_at": TODAY,
        "status": "illustrative",
        "disclaimer": (
            "Allocations fictives construites pour la demonstration. Ne reproduisent "
            "pas les allocations reelles de Yomoni. Les poids actuels/derives sont "
            "simules et recalcules a partir des prix de marche publics quand disponibles."
        ),
        "profiles": profiles,
    })


# ---------------------------------------------------------------------------
# ESG reference data (peer comparison + greenwashing checklist)
# ---------------------------------------------------------------------------
def build_esg() -> None:
    comparison = [
        {
            "peer_group": "Actions Monde",
            "variants": [
                {"ticker": "IWDA.AS", "label": "Classique", "sfdr": "Article 6", "carbon_intensity_proxy": "Non calcule (necessite fournisseur ESG)", "status": "illustrative"},
                {"ticker": "n/a", "label": "Screened (exclusions)", "sfdr": "Article 8", "carbon_intensity_proxy": "Reduction attendue modeste vs indice parent", "status": "illustrative_placeholder"},
                {"ticker": "n/a", "label": "SRI / PAB", "sfdr": "Article 9", "carbon_intensity_proxy": "Reduction attendue forte, univers reduit", "status": "illustrative_placeholder"},
            ],
        },
        {
            "peer_group": "Europe",
            "variants": [
                {"ticker": "MEUD.PA", "label": "Classique", "sfdr": "Article 6", "status": "verified_identity_only"},
                {"ticker": "ESGE.PA", "label": "ESG Selection (Leaders, cap 5%)", "sfdr": "Article 8", "status": "verified_identity_only"},
            ],
        },
        {
            "peer_group": "Actions Etats-Unis",
            "variants": [
                {"ticker": "CSPX.AS", "label": "Classique", "sfdr": "Article 6", "status": "verified_identity_only"},
                {"ticker": "ESE.PA", "label": "ESG tilt", "sfdr": "Article 8", "status": "verified_identity_only"},
            ],
        },
    ]

    greenwashing_checklist = [
        "Le nom du fonds correspond-il a la methodologie reellement appliquee ?",
        "Les exclusions sont-elles significatives ou marginales ?",
        "L'indice ESG differe-t-il suffisamment de l'indice parent (tracking error mesurable) ?",
        "La reduction carbone est-elle mesurable et documentee ?",
        "La couverture des donnees ESG est-elle suffisante (part notee vs non notee) ?",
        "Les objectifs annonces sont-ils absolus ou relatifs a l'indice parent ?",
        "Les controverses sont-elles traitees par une politique documentee ?",
        "La methodologie ESG a-t-elle change recemment sans communication claire ?",
        "Le produit conserve-t-il des expositions sectorielles controversees malgre le label ?",
        "Le cout financier de l'approche ESG (TER, tracking error) est-il explicite ?",
    ]

    write_json("esg_data.json", {
        "generated_at": TODAY,
        "disclaimer": (
            "Le module ESG combine des identites d'ETF verifiees (nom, ISIN, TER, SFDR) "
            "avec des indicateurs de durabilite illustratifs quand aucune source publique "
            "gratuite ne fournit l'intensite carbone ou la couverture des donnees. "
            "Ceci n'est jamais presente comme une notation ESG officielle."
        ),
        "comparison_sets": comparison,
        "greenwashing_checklist": greenwashing_checklist,
        "methodology_note": (
            "Une note ESG depend de la methodologie du fournisseur, de la materialite "
            "retenue, de la qualite et de la couverture des donnees, et des estimations "
            "utilisees pour combler les donnees manquantes. Article 8 ou Article 9 ne "
            "suffit pas seul a juger la qualite d'un produit."
        ),
    })


# ---------------------------------------------------------------------------
# Competitor watch timeline (illustrative structure, to be updated manually)
# ---------------------------------------------------------------------------
def build_news() -> None:
    items = [
        {
            "date": "to_confirm",
            "actor": "to_confirm",
            "category": "example",
            "title": "Exemple : nouvelle enveloppe fiscale ajoutee a l'offre",
            "status": "illustrative_placeholder",
            "note": "Structure d'entree a completer manuellement lors de la veille reelle (source + date + lien).",
        },
        {
            "date": "to_confirm",
            "actor": "to_confirm",
            "category": "example",
            "title": "Exemple : evolution tarifaire sur un profil de gestion pilotee",
            "status": "illustrative_placeholder",
            "note": "Structure d'entree a completer manuellement lors de la veille reelle (source + date + lien).",
        },
    ]
    write_json("news.json", {
        "generated_at": TODAY,
        "disclaimer": (
            "Fichier facilement editable a la main pour la veille concurrentielle. "
            "Les entrees ci-dessous sont des exemples de structure, pas des faits verifies."
        ),
        "items": items,
    })


def main() -> None:
    DATA.mkdir(parents=True, exist_ok=True)
    build_etf_universe()
    build_competitors()
    build_allocations()
    build_esg()
    build_news()
    log("done")


if __name__ == "__main__":
    main()
