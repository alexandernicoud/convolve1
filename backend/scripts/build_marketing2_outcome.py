"""
Build the homepage's labelling example from real local artifacts.

Takes two of the hero's test charts (MSFT, one take-profit and one stop-loss case) and resolves
their labels with the shared outcome contract (``app.services.trade_outcomes``) on the daily
OHLCV stored with test set bc4cb464. The script fails if a resolved label differs from the
stored one.

Writes ``src/features/marketing2/data/outcome.json`` (no paths, ids or e-mails).

Usage (from backend/):
    .venv/bin/python scripts/build_marketing2_outcome.py --user <uuid>
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import pandas as pd

BACKEND = Path(__file__).resolve().parents[1]
REPO = BACKEND.parent
OUT = REPO / "src/features/marketing2/data/outcome.json"
HERO = REPO / "src/features/marketing2/data/hero.json"
sys.path.insert(0, str(BACKEND))

from app.services import trade_outcomes as outcomes  # noqa: E402

TEST_SET = "dataset_20261022_125126_bc4cb464"
SYMBOL = "MSFT"
RULE = {"tp": 0.02, "sl": 0.01, "horizon": 7}
CONTEXT_BARS = 12
EXAMPLES = ("2025-06-23", "2025-11-18")


def bar(ts: pd.Timestamp, row: pd.Series) -> dict:
    return {"d": ts.strftime("%Y-%m-%d"), **{k[0].lower(): round(float(row[k]), 2) for k in ("Open", "High", "Low", "Close")}}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--user", required=True)
    args = ap.parse_args()

    samples = {x["date"]: x for x in json.loads(HERO.read_text())["samples"]}

    csv = BACKEND / "datasets" / args.user / TEST_SET / "provenance" / "ohlcv" / f"{SYMBOL}.csv"
    df = pd.read_csv(csv)
    df.index = pd.to_datetime(df["timestamp"], utc=True).dt.tz_convert("America/New_York")
    df = df[["Open", "High", "Low", "Close"]]
    spec = outcomes.OutcomeSpec(horizon_bars=RULE["horizon"], tp_frac=RULE["tp"], sl_frac=RULE["sl"], timeframe="1d")

    examples = []
    for decision in EXAMPLES:
        sample = samples[decision]
        dec_ts = df.index[df.index.strftime("%Y-%m-%d") == decision][0]
        out = outcomes.resolve_outcome(df, dec_ts, spec)
        label = outcomes.label_for_method(out, outcomes.LABEL_METHOD_V2)
        if label != int(sample["label"]):
            raise SystemExit(f"{decision}: resolved label {label} differs from stored label {sample['label']}")
        i = df.index.get_loc(dec_ts)
        window = df.iloc[i - CONTEXT_BARS : i + 1 + RULE["horizon"]]
        examples.append(
            {
                "decision": decision,
                "start": sample["start"],
                "image": sample["file"],
                "entry": {"d": out.entry_ts.strftime("%Y-%m-%d"), "price": round(out.entry_price, 2)},
                "tp_price": round(out.tp_price, 2),
                "sl_price": round(out.sl_price, 2),
                "exit": {"d": out.exit_ts.strftime("%Y-%m-%d"), "price": round(out.exit_price, 2), "reason": out.exit_reason, "bars_held": out.bars_held},
                "label": label,
                "bars": [bar(ts, row) for ts, row in window.iterrows()],
            }
        )
        print(f"{decision}: label {label} ({out.exit_reason} after {out.bars_held} bar(s))")

    payload = {
        "provenance": f"Daily {SYMBOL} OHLCV stored with Convolve test set bc4cb464; outcomes resolved with the "
        f"Generator's labelling contract ({outcomes.OUTCOME_CONVENTION}).",
        "symbol": SYMBOL,
        "rule": RULE,
        "convention": outcomes.OUTCOME_CONVENTION,
        "context_bars": CONTEXT_BARS,
        "examples": examples,
    }
    text = json.dumps(payload, indent=1)
    for forbidden in (args.user, str(BACKEND), "@"):
        if forbidden in text:
            raise SystemExit("forbidden string in output")
    OUT.write_text(text + "\n")
    print(f"wrote {OUT.relative_to(REPO)}")


if __name__ == "__main__":
    main()
