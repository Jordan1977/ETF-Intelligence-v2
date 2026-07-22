"""
update_market_data.py

Downloads public market data (indices, rates proxy, FX, gold, oil, VIX) via
yfinance and writes data/market_data.json. Designed to NEVER break the site:
if a ticker or the whole network call fails, the previous cached value is
kept and the field is marked as stale rather than deleted.

Usage:
    python scripts/update_market_data.py
"""
from __future__ import annotations

import json
import math
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd

try:
    import yfinance as yf
    YF_AVAILABLE = True
except Exception:  # pragma: no cover - environment without yfinance
    YF_AVAILABLE = False

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
OUT_PATH = DATA / "market_data.json"

TODAY = datetime.now(timezone.utc).strftime("%Y-%m-%d")

# ticker -> (display name, group)
INSTRUMENTS = {
    "URTH": ("MSCI World (proxy)", "indices"),
    "^GSPC": ("S&P 500", "indices"),
    "^NDX": ("Nasdaq-100", "indices"),
    "^STOXX50E": ("Euro Stoxx 50", "indices"),
    "^STOXX": ("STOXX Europe 600", "indices"),
    "EEM": ("MSCI Emerging Markets (proxy)", "indices"),
    "EURUSD=X": ("EUR/USD", "fx"),
    "DX-Y.NYB": ("Dollar Index (proxy)", "fx"),
    "GC=F": ("Or (future, proxy)", "commodities"),
    "BZ=F": ("Petrole Brent (future, proxy)", "commodities"),
    "^VIX": ("Volatilite (VIX)", "risk"),
    "^TNX": ("Taux 10 ans US (proxy, x10)", "rates"),
}

PERIODS = {
    "1w": 5, "1m": 21, "3m": 63, "6m": 126,
    "1y": 252, "3y": 756,
}


def log(msg: str) -> None:
    print(f"[update_market_data] {msg}", flush=True)


def load_previous() -> dict:
    if OUT_PATH.exists():
        try:
            return json.loads(OUT_PATH.read_text(encoding="utf-8"))
        except Exception:
            return {}
    return {}


def safe_float(x):
    try:
        x = float(x)
        if math.isnan(x) or math.isinf(x):
            return None
        return x
    except Exception:
        return None


def compute_returns(series: pd.Series) -> dict:
    out = {}
    if series is None or series.empty:
        return {k: None for k in list(PERIODS) + ["ytd"]}
    last = series.iloc[-1]
    for label, n in PERIODS.items():
        if len(series) > n:
            base = series.iloc[-(n + 1)]
            out[label] = safe_float((last / base - 1) * 100) if base else None
        else:
            out[label] = None
    # YTD
    this_year = series[series.index.year == series.index[-1].year]
    if not this_year.empty:
        base = this_year.iloc[0]
        out["ytd"] = safe_float((last / base - 1) * 100) if base else None
    else:
        out["ytd"] = None
    return out


def fetch_one(ticker: str):
    try:
        hist = yf.download(ticker, period="4y", progress=False, auto_adjust=True)
        if hist is None or hist.empty:
            return None
        col = "Close" if "Close" in hist.columns else hist.columns[0]
        series = hist[col].dropna()
        if isinstance(series, pd.DataFrame):
            series = series.iloc[:, 0]
        return series
    except Exception as exc:
        log(f"WARN fetch failed for {ticker}: {exc}")
        return None


def main() -> None:
    previous = load_previous()
    prev_instruments = {i["ticker"]: i for i in previous.get("instruments", [])}

    instruments = []
    any_success = False

    if not YF_AVAILABLE:
        log("yfinance not installed; keeping previous data as-is (marked stale).")
        for ticker, (label, group) in INSTRUMENTS.items():
            fallback = prev_instruments.get(ticker)
            if fallback:
                fallback["status"] = "stale_no_network"
                instruments.append(fallback)
            else:
                instruments.append({
                    "ticker": ticker, "name": label, "group": group,
                    "status": "unavailable", "as_of": None, "returns_pct": {k: None for k in list(PERIODS) + ["ytd"]},
                })
    else:
        for ticker, (label, group) in INSTRUMENTS.items():
            series = fetch_one(ticker)
            if series is not None and not series.empty:
                any_success = True
                instruments.append({
                    "ticker": ticker,
                    "name": label,
                    "group": group,
                    "status": "ok",
                    "as_of": str(series.index[-1].date()),
                    "last_value": safe_float(series.iloc[-1]),
                    "returns_pct": compute_returns(series),
                    "source": "Yahoo Finance (via yfinance)",
                })
            else:
                fallback = prev_instruments.get(ticker)
                if fallback:
                    fallback["status"] = "stale_fetch_failed"
                    instruments.append(fallback)
                else:
                    instruments.append({
                        "ticker": ticker, "name": label, "group": group,
                        "status": "unavailable", "as_of": None,
                        "returns_pct": {k: None for k in list(PERIODS) + ["ytd"]},
                    })

    payload = {
        "generated_at": TODAY,
        "last_successful_update": TODAY if any_success else previous.get("last_successful_update"),
        "source": "Yahoo Finance (public, delayed quotes) via yfinance",
        "disclaimer": (
            "Donnees de marche publiques a titre illustratif. Peuvent etre differees. "
            "Les indices utilises sont des proxys publics (ETF ou index Yahoo Finance), "
            "pas necessairement les benchmarks officiels."
        ),
        "instruments": instruments,
    }

    DATA.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    log(f"wrote {OUT_PATH.relative_to(ROOT)} (network_ok={any_success})")


if __name__ == "__main__":
    main()
