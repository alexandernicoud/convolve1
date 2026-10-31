"""Monthly gross margin per subscriber for Research and Professional under light, typical
and heavy use. Read-only: prints a table, changes nothing.

    python -m scripts.plan_economics

Inputs (October 2026). "measured" values come from Cloud Run execution history and the
Cloud Billing catalogue for europe-west6; "assumed" values are estimates, marked as such.

* Cloud Run jobs, europe-west6 (Cloud Billing SKUs "Jobs CPU/Memory in europe-west6"):
  USD 0.0000216 per vCPU-second, USD 0.0000024 per GiB-second (measured, list price).
* Pipeline service (generator, analysis, backtests): 2 vCPU / 8 GiB, instance-based billing,
  same unit prices, so USD 0.0000624 per second while an instance is up; it stays up for
  up to ~15 minutes after the last request (the "session tail").
* Trainer job: 8 vCPU / 8 GiB. Three production executions: 2,550 / 557 / 81 images took
  306 / 125 / 50 s end to end, i.e. USD 0.0033 / 0.0040 / 0.0032 per credit charged (the
  price assumes 30 epochs; early stopping usually ends sooner). Worst case without early
  stopping: ~USD 0.0146 per credit (264 s fit as the minimum 6 epochs, scaled to 30).
* Bot job: 2 vCPU / 4 GiB, every 15 minutes. 200 executions: median 14.7 s, mean 15.9 s with
  no bot due; runs with due bots took 40-82 s, i.e. 25-67 s per bot run. Each bot runs at
  most once per day.
* Other credits (generator, analysis, backtest, test data, optimizer) are calibrated to
  30-60 s of Apple-silicon compute per credit; the 2-vCPU pipeline service is assumed 1.5-3x
  slower (assumed).
* Storage: GCS europe-west6 Standard ~USD 0.026 per GB-month (assumed list price); the whole
  bucket currently holds 2.39 GB (measured).
* Stripe, Swiss account charging USD: international cards 3.25 % + CHF 0.30 (~USD 0.33),
  currency conversion 2 %, Stripe Billing 0.7 % (assumed from Stripe's public price list).
* Prices are treated as excluding VAT. If prices are VAT-inclusive for EU consumers, revenue
  falls by up to ~21 % (VAT_SENSITIVITY).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, List

JOB_CPU_S = 0.0000216
JOB_GIB_S = 0.0000024
PIPELINE_PER_S = 2 * JOB_CPU_S + 8 * JOB_GIB_S
BOT_JOB_PER_S = 2 * JOB_CPU_S + 4 * JOB_GIB_S
SESSION_TAIL_S = 15 * 60

TRAIN_COST_PER_CREDIT = {"light": 0.0035, "typical": 0.0040, "heavy": 0.0146}
OTHER_SECONDS_PER_CREDIT = {"light": 45, "typical": 90, "heavy": 180}
BOT_SECONDS_PER_RUN = {"light": 25, "typical": 40, "heavy": 67}
BOT_RUNS_PER_MONTH = 30
STORAGE_PER_GB = 0.026
STRIPE_PCT = 0.0325 + 0.02 + 0.007
STRIPE_FIXED = 0.33
VAT_SENSITIVITY = 0.21
BOT_TICKER_PLATFORM = 2880 * 15.9 * BOT_JOB_PER_S  # fixed, shared by all users


@dataclass
class Usage:
    credit_share: float      # share of the monthly credits used
    training_share: float    # share of used credits spent on training
    deployment_share: float  # share of the deployment limit in use
    storage_gb: float
    sessions: int            # working sessions that start a pipeline instance


SCENARIOS: Dict[str, Usage] = {
    "light": Usage(0.25, 0.5, 0.34, 0.5, 4),
    "typical": Usage(0.60, 0.6, 0.5, 2.0, 12),
    "heavy": Usage(1.00, 0.8, 1.0, 10.0, 30),
}


@dataclass
class Plan:
    name: str
    price: float
    credits: int
    deployments: int


def plans() -> List[Plan]:
    from app.billing import catalog

    cat = catalog.load("")
    out = []
    for tid in ("starter", "research", "professional"):
        t = catalog.tier(tid, cat)
        out.append(Plan(f"{t['name']} (catalogue)", t["price"]["amount_minor"] / 100, int(t["monthly_credits"]),
                        int(t["quotas"]["active_deployments"])))
    price = out[-1].price
    for credits in (600, 900, 1200):
        for deployments in (10, 20):
            out.append(Plan(f"Professional {credits:,} / {deployments}", price, credits, deployments))
    return out


# Paper bots run one after another in a single Cloud Run job task (bots-job.yaml:
# parallelism 1, taskCount 1); each bot runs at most once per day. Daily bot runs one serial
# worker can complete, and how many fully used plans that serves.
def bot_capacity(deployments: int) -> Dict[str, float]:
    return {level: 86400 / s / deployments for level, s in BOT_SECONDS_PER_RUN.items()}


def monthly(plan: Plan, level: str) -> Dict[str, float]:
    u = SCENARIOS[level]
    used = plan.credits * u.credit_share
    train = used * u.training_share * TRAIN_COST_PER_CREDIT[level]
    other = used * (1 - u.training_share) * OTHER_SECONDS_PER_CREDIT[level] * PIPELINE_PER_S
    tails = u.sessions * SESSION_TAIL_S * PIPELINE_PER_S
    bots = round(plan.deployments * u.deployment_share) * BOT_RUNS_PER_MONTH * BOT_SECONDS_PER_RUN[level] * BOT_JOB_PER_S
    storage = u.storage_gb * STORAGE_PER_GB
    stripe = plan.price * STRIPE_PCT + STRIPE_FIXED
    cost = train + other + tails + bots + storage + stripe
    net = plan.price - cost
    return {
        "compute": train + other + tails, "bots": bots, "storage": storage, "stripe": stripe, "cost": cost,
        "margin": net / plan.price, "margin_vat_incl": (plan.price / (1 + VAT_SENSITIVITY) - cost) / (plan.price / (1 + VAT_SENSITIVITY)),
    }


def main() -> None:
    print(f"Fixed platform cost of the 15-minute bot ticker: USD {BOT_TICKER_PLATFORM:.2f} per month (all users)\n")
    head = f"{'Plan':38s} {'Use':8s} {'Compute':>8s} {'Bots':>6s} {'Storage':>8s} {'Stripe':>7s} {'Cost':>7s} {'Margin':>7s} {'VAT-incl':>8s}"
    print(head)
    print("-" * len(head))
    for p in plans():
        for level in SCENARIOS:
            m = monthly(p, level)
            print(f"{p.name:38s} {level:8s} {m['compute']:8.2f} {m['bots']:6.2f} {m['storage']:8.2f} {m['stripe']:7.2f} "
                  f"{m['cost']:7.2f} {m['margin']:7.0%} {m['margin_vat_incl']:8.0%}")
        cap = bot_capacity(p.deployments)
        print(f"{'':38s} price per credit USD {p.price / p.credits:.3f}; worst-case compute per credit USD "
              f"{monthly(p, 'heavy')['compute'] / p.credits:.4f}")
        print(f"{'':38s} users with every deployment active that one bot worker serves: "
              f"{cap['heavy']:.0f} (67 s/run) to {cap['light']:.0f} (25 s/run)\n")


if __name__ == "__main__":
    main()
