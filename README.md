# ETF Intelligence Platform

**ETF Selection, Monitoring, ESG & Competitor Intelligence** — Jordan Scouarnec

Prototype pédagogique destiné à montrer comment des données publiques peuvent être
structurées pour préparer un comité de gestion / sélection ETF, suivre les marchés
et les allocations, comparer des ETF, intégrer sérieusement l'ESG, surveiller les
risques opérationnels et centraliser une veille concurrentielle — le tout déployé
gratuitement sur GitHub Pages, sans backend.

> Ce projet ne reproduit ni les modèles, ni les allocations, ni les règles internes
> de Yomoni. Il ne constitue en aucun cas un conseil en investissement.

## Ce qui a changé par rapport à la v1

La v1 (shortlist statique + `generate_dashboard.py` → Plotly) est conservée dans
l'historique Git. La v2 sépare clairement :

- **Génération de données** (Python, `scripts/`) → écrit des fichiers JSON dans `data/`.
- **Présentation** (`index.html` + `assets/`) → lit ces JSON *au runtime* via `fetch`,
  sans étape de build. Cela permet à GitHub Actions de mettre à jour uniquement
  les données, sans jamais retoucher au HTML/CSS/JS.

Rien de l'ancien contenu (mentions de prudence, ETF déjà documentés, concurrents
suivis) n'a été supprimé : il a été intégré dans la nouvelle structure et étendu.

## Architecture

```
/
├── index.html                     # shell + navigation par onglets
├── assets/
│   ├── css/style.css              # thème (repris de la v1)
│   └── js/app.js                  # chargement des données, alertes, rendu des onglets
├── data/
│   ├── etf_universe_source.csv    # source éditable à la main : univers ETF
│   ├── competitors_source.csv     # source éditable à la main : concurrents
│   ├── etf_universe.json          # généré : identité + TER/AUM + métriques calculées
│   ├── competitors.json           # généré
│   ├── allocations.json           # généré : profils illustratifs
│   ├── esg_data.json              # généré : comparaisons ESG + grille greenwashing
│   ├── news.json                  # édité à la main : veille concurrentielle
│   └── market_data.json           # généré : indices, taux, FX, or, pétrole, VIX
├── scripts/
│   ├── build_dashboard_data.py    # CSV → JSON, sans réseau, ne peut pas casser le site
│   ├── update_market_data.py      # yfinance → market_data.json, dégrade proprement
│   ├── compute_etf_metrics.py     # yfinance → métriques de risque/tracking par ETF
│   └── validate_data.py           # contrôle qualité avant commit
├── .github/workflows/update-dashboard.yml
└── requirements.txt
```

## Installation locale

```bash
python -m venv .venv
source .venv/bin/activate   # Windows : .venv\Scripts\activate
pip install -r requirements.txt

python scripts/build_dashboard_data.py   # régénère les JSON statiques (pas de réseau)
python scripts/update_market_data.py     # marchés (réseau requis, sinon garde le cache)
python scripts/compute_etf_metrics.py    # métriques ETF (réseau requis)
python scripts/validate_data.py          # contrôle qualité

python -m http.server 8000                # puis ouvrir http://localhost:8000
```

## Publication GitHub Pages

1. `Settings > Pages` → **Deploy from a branch** → `main` → `/ (root)`.
2. Le lien attendu est `https://VOTRE-PSEUDO.github.io/ETF-Intelligence/`.
3. Aucune étape de build n'est nécessaire : `index.html` lit directement les JSON du dossier `data/`.

## GitHub Actions

`Actions` → **Update ETF Intelligence Dashboard** → **Run workflow** (ou attend le
cron quotidien en semaine). Le workflow :

1. régénère les fichiers statiques (aucun risque réseau) ;
2. tente de rafraîchir les données de marché et les métriques ETF (`continue-on-error: true`
   — une source indisponible ne fait jamais échouer le job, elle est marquée `stale`) ;
3. valide tous les JSON ;
4. ne committe que s'il y a un changement réel.

## Comment étendre le dashboard

- **Ajouter un ETF** : ajouter une ligne à `data/etf_universe_source.csv`
  (respecter `verification_status` : `verified` seulement si TER/ISIN/domicile sont
  confirmés sur une source officielle), puis lancer `build_dashboard_data.py`.
- **Ajouter un concurrent** : idem dans `data/competitors_source.csv`.
- **Ajouter une allocation** : éditer la liste `profiles` dans
  `scripts/build_dashboard_data.py::build_allocations()`.
- **Mettre à jour une donnée ESG** : éditer `build_esg()` dans le même script — toute
  donnée non vérifiée doit rester marquée `illustrative` ou `to_confirm`.
- **Ajouter une actualité concurrentielle** : éditer directement `data/news.json`
  (pas besoin de relancer un script).

## Méthodologie (résumé — détail dans l'onglet Méthodologie du site)

- Volatilité annualisée : écart-type des rendements journaliers × √252.
- Maximum drawdown : pire baisse depuis un sommet historique.
- Sharpe (rf = 0) : rendement annualisé ÷ volatilité annualisée.
- Tracking difference : écart moyen de performance (ETF − proxy public de l'indice).
- Tracking error : volatilité annualisée de cet écart.

Les seuils utilisés dans le module Monitoring (TER > 0,40 %, tracking error > 1,0 %,
donnée non vérifiée depuis plus de 180 jours, drawdown < −20 %) sont **illustratifs**
et modifiables dans `assets/js/app.js::computeAlerts()`. Ils ne représentent pas les
critères internes de Yomoni.

## Limites importantes

- Yahoo Finance n'est pas une source institutionnelle ; les cours peuvent être différés.
- Les tickers de benchmark (URTH, ^GSPC, ^STOXX…) sont des **proxys publics**, pas
  nécessairement les indices officiels des ETF suivis.
- Les données ESG (intensité carbone, couverture, controverses) ne sont pas
  disponibles gratuitement et en temps réel : elles sont marquées `illustrative`
  chaque fois qu'aucune source publique vérifiée n'est disponible.
- Les allocations « actuelles » sont **simulées** (dérive déterministe autour de la
  cible) pour illustrer la logique de rééquilibrage — aucun lien avec un portefeuille réel.
- Le TER, l'encours, le domicile et la classification SFDR/ESG de certains ETF récemment
  ajoutés sont marqués `to_confirm` : à revalider sur la documentation officielle
  avant toute utilisation professionnelle.
- Ce projet ne constitue pas une recommandation d'investissement.

## Données réelles vs. illustratives (résumé)

| Donnée | Statut |
|---|---|
| Nom, ISIN, TER, réplication, domicile des 7 ETF de la v1 | Vérifié (sources officielles, 2026-07-20) |
| ISIN / TER des 4 ETF ajoutés (EM, Govt Bond, Or, Europe ESG) | Vérifié via justETF (2026-07-21) |
| Encours, domicile exact, date de lancement de certains ajouts | À confirmer |
| Intensité carbone, couverture ESG, controverses | Illustratif (aucune source publique gratuite fiable identifiée) |
| Allocations cibles et actuelles | Illustratif |
| Chronologie de veille concurrentielle (`news.json`) | Structure d'exemple, à peupler manuellement |
| Positionnement des 4 concurrents (Yomoni, Nalo, Ramify, Goodvest) | Vérifié (pages tarifaires officielles, 2026-07-20) |

## Pitch entretien

> En lisant la fiche de poste, j'ai identifié les besoins opérationnels d'un
> Assistant Gérant ETF : préparer les comités, suivre les marchés et les
> allocations, sélectionner des ETF, intégrer l'ESG sans se contenter d'une
> classification Article 8/9, surveiller les risques opérationnels et centraliser
> la veille concurrentielle. J'ai construit un prototype fondé sur des données
> publiques qui automatise la collecte et les contrôles, calcule des indicateurs
> de risque et de réplication, et fait remonter des alertes selon des règles
> transparentes et modifiables — sans jamais déclencher de décision automatique.
> L'objectif n'est pas de remplacer le jugement du gérant, mais de structurer sa
> préparation et de rendre visibles les points qui méritent une analyse.

## Vérifications avant entretien

- ouvrir le lien en navigation privée ;
- lancer manuellement le workflow GitHub Actions ;
- savoir expliquer tracking error vs. tracking difference ;
- préciser quelles données sont illustratives (module ESG, allocations) ;
- montrer dans l'ordre : Comité → ESG → Screener → Monitoring → Concurrents.
