"""
compute_etf_metrics.py

For each ETF in data/etf_universe.json, downloads price history via yfinance
and computes: 1y return, annualised volatility, max drawdown, Sharpe (rf=0),
and tracking difference / tracking error versus the declared public proxy
index. Never crashes the pipeline: any ETF/proxy that fails to download
keeps metrics.status = "not_computed" instead of a fabricated number.

Usage:
    python scripts/compute_etf_metrics.py
"""
from __future__ import annotations

import json
import math
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd

try:
    import yfinance as yf
    YF_AVAILABLE = True
except Exception:
    YF_AVAILABLE = False

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
UNIVERSE_PATH = DATA / "etf_universe.json"
TRADING_DAYS = 252
TODAY = datetime.now(timezone.utc).strftime("%Y-%m-%d")


def log(msg: str) -> None:
    print(f"[compute_etf_metrics] {msg}", flush=True)


def safe_float(x):
    try:
        x = float(x)
        return None if (math.isnan(x) or math.isinf(x)) else round(x, 4)
    except Exception:
        return None


def download_series(ticker: str):
    try:
        hist = yf.download(ticker, period="2y", progress=False, auto_adjust=True)
        if hist is None or hist.empty:
            return None
        col = "Close" if "Close" in hist.columns else hist.columns[0]
        s = hist[col].dropna()
        if isinstance(s, pd.DataFrame):
            s = s.iloc[:, 0]
        return s
    except Exception as exc:
        log(f"WARN download failed for {ticker}: {exc}")
        return None


def metrics_for(etf_series: pd.Series, proxy_series: pd.Series | None) -> dict:
    rets = etf_series.pct_change().dropna()
    if len(rets) < 20:
        return {"status": "insufficient_history"}

    total_return = (etf_series.iloc[-1] / etf_series.iloc[0]) - 1
    vol = rets.std() * math.sqrt(TRADING_DAYS)
    running_max = etf_series.cummax()
    drawdown = (etf_series / running_max - 1)
    max_dd = drawdown.min()
    sharpe = (rets.mean() * TRADING_DAYS) / vol if vol else None

    out = {
        "status": "computed",
        "as_of": str(etf_series.index[-1].date()),
        "return_1y": safe_float(total_return * 100),
        "volatility_1y": safe_float(vol * 100),
        "max_drawdown_1y": safe_float(max_dd * 100),
        "sharpe_1y": safe_float(sharpe),
        "tracking_difference_1y": None,
        "tracking_error_1y": None,
        "note": "Le proxy d'indice n'est pas necessairement le benchmark officiel (ecarts devise/dividendes possibles).",
    }

    if proxy_series is not None and len(proxy_series) > 20:
        aligned = pd.concat([etf_series, proxy_series], axis=1, join="inner").dropna()
        if len(aligned) > 20:
            etf_r = aligned.iloc[:, 0].pct_change().dropna()
            proxy_r = aligned.iloc[:, 1].pct_change().dropna()
            common = etf_r.index.intersection(proxy_r.index)
            diff = etf_r.loc[common] - proxy_r.loc[common]
            etf_total = aligned.iloc[-1, 0] / aligned.iloc[0, 0] - 1
            proxy_total = aligned.iloc[-1, 1] / aligned.iloc[0, 1] - 1
            out["tracking_difference_1y"] = safe_float((etf_total - proxy_total) * 100)
            out["tracking_error_1y"] = safe_float(diff.std() * math.sqrt(TRADING_DAYS) * 100)

    return out


def main() -> None:
    if not UNIVERSE_PATH.exists():
        log("etf_universe.json missing; run build_dashboard_data.py first.")
        return

    universe = json.loads(UNIVERSE_PATH.read_text(encoding="utf-8"))

    if not YF_AVAILABLE:
        log("yfinance not installed; leaving metrics as not_computed.")
        UNIVERSE_PATH.write_text(json.dumps(universe, ensure_ascii=False, indent=2), encoding="utf-8")
        return

    proxy_cache: dict[str, pd.Series | None] = {}

    for etf in universe["etfs"]:
        ticker = etf["ticker"]
        proxy_ticker = etf.get("benchmark", {}).get("proxy_ticker")

        etf_series = download_series(ticker)
        if etf_series is None:
            etf["metrics"] = {"status": "not_computed", "as_of": None}
            continue

        proxy_series = None
        if proxy_ticker:
            if proxy_ticker not in proxy_cache:
                proxy_cache[proxy_ticker] = download_series(proxy_ticker)
            proxy_series = proxy_cache[proxy_ticker]

        etf["metrics"] = metrics_for(etf_series, proxy_series)

    universe["generated_at"] = TODAY
    UNIVERSE_PATH.write_text(json.dumps(universe, ensure_ascii=False, indent=2), encoding="utf-8")
    log(f"updated metrics in {UNIVERSE_PATH.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
