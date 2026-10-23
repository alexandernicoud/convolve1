"""CLI entry for the v2 price-based backtest (run as a subprocess by runners/new_backtester_runner.py)."""

import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.services.backtest_engine.pipeline import BacktestInputError, run  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", required=True)
    args = ap.parse_args()
    with open(args.config) as f:
        config = json.load(f)

    def progress(p: float, msg: str) -> None:
        print(f"PROGRESS {p:.3f} {msg}", flush=True)

    try:
        res = run(config, progress)
    except BacktestInputError as exc:
        print(f"INPUT_ERROR: {exc}", flush=True)
        return 3
    tm = res.get("trading_metrics", {})
    print(f"Executed trades: {tm.get('executed_trades')}; total return: {(tm.get('total_return') or {}).get('value')}", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
