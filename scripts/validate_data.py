"""
validate_data.py

Sanity-checks every JSON file in data/ before the site is allowed to
consider a GitHub Actions run "clean". Exits with a non-zero status only
on structural problems (missing required file, broken JSON, duplicate
ticker/ISIN, allocation weights far from 100%). Never blocks on a single
stale market data point - that is expected and handled by the front-end.

Usage:
    python scripts/validate_data.py
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"

REQUIRED_FILES = [
    "etf_universe.json",
    "competitors.json",
    "allocations.json",
    "esg_data.json",
    "news.json",
    "market_data.json",
]

errors: list[str] = []
warnings: list[str] = []


def load(name: str):
    path = DATA / name
    if not path.exists():
        errors.append(f"MISSING FILE: {name}")
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        errors.append(f"INVALID JSON in {name}: {exc}")
        return None


def check_etf_universe(data):
    if not data:
        return
    seen_tickers, seen_isin = set(), set()
    required_fields = ["ticker", "name", "isin", "provider", "category", "ter", "verification_status"]
    for etf in data.get("etfs", []):
        for f in required_fields:
            if f not in etf:
                errors.append(f"ETF {etf.get('ticker', '?')} missing field '{f}'")
        t, i = etf.get("ticker"), etf.get("isin")
        if t in seen_tickers:
            errors.append(f"Duplicate ticker: {t}")
        if i in seen_isin:
            errors.append(f"Duplicate ISIN: {i}")
        seen_tickers.add(t)
        seen_isin.add(i)
        if etf.get("verification_status") not in {"verified", "partial", "to_confirm"}:
            warnings.append(f"ETF {t}: unexpected verification_status '{etf.get('verification_status')}'")


def check_allocations(data):
    if not data:
        return
    for profile in data.get("profiles", []):
        weights = profile.get("target_weights", {})
        total = sum(v for v in weights.values() if isinstance(v, (int, float)))
        if abs(total - 100) > 1.0:
            errors.append(f"Allocation '{profile.get('id')}' weights sum to {total}, expected ~100")


def check_market_data(data):
    if not data:
        return
    if "instruments" not in data:
        errors.append("market_data.json missing 'instruments' key")
        return
    for inst in data["instruments"]:
        if inst.get("status") not in {"ok", "stale_no_network", "stale_fetch_failed", "unavailable"}:
            warnings.append(f"Instrument {inst.get('ticker')} has unexpected status '{inst.get('status')}'")


def main() -> int:
    for name in REQUIRED_FILES:
        data = load(name)
        if name == "etf_universe.json":
            check_etf_universe(data)
        elif name == "allocations.json":
            check_allocations(data)
        elif name == "market_data.json":
            check_market_data(data)

    print(f"[validate_data] {len(errors)} error(s), {len(warnings)} warning(s)")
    for w in warnings:
        print(f"  WARNING: {w}")
    for e in errors:
        print(f"  ERROR: {e}")

    if errors:
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
