"""Give accounts that existed before paid plans started 60 days of complimentary Research.

Dry run by default: prints how many accounts would get the grant and why others would not,
and changes nothing. Writing needs ``--apply`` and ``--confirm N`` where N is the number the
dry run reported, so a different database or a changed account set stops the run.

    python -m scripts.grant_beta_access --activation 2026-11-01T00:00:00Z
    python -m scripts.grant_beta_access --activation 2026-11-01T00:00:00Z --apply --confirm 42

Eligible: profiles created before the activation time. Accounts with a paid subscription or
an earlier beta grant are skipped. No payment provider is contacted; nothing is charged and
nothing renews. Uses DATABASE_URL like the API. Prints counts only, never emails.
"""

from __future__ import annotations

import argparse
import sys
from collections import Counter
from datetime import datetime, timedelta, timezone


def _parse(value: str) -> datetime:
    t = datetime.fromisoformat(value.replace("Z", "+00:00"))
    return t if t.tzinfo else t.replace(tzinfo=timezone.utc)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--activation", required=True, help="Commercial activation time (ISO 8601, UTC)")
    ap.add_argument("--apply", action="store_true", help="Write the grants (default: dry run)")
    ap.add_argument("--confirm", type=int, help="Number of accounts the dry run reported; required with --apply")
    args = ap.parse_args(argv)

    from app.billing import beta, service
    from app.db import SessionLocal, engine
    from app.models import Profile

    activation = _parse(args.activation)
    now = datetime.now(timezone.utc)
    db = SessionLocal()
    try:
        ids = [pid for (pid,) in db.query(Profile.id).filter(Profile.created_at < activation).order_by(Profile.created_at)]
        outcome = Counter(beta.eligibility(db, pid, now) or "eligible" for pid in ids)
        print(f"Database: {engine.url.render_as_string(hide_password=True)}")
        print(f"Activation: {activation.isoformat()}  ends: {(activation + timedelta(days=beta.DAYS)).isoformat()}")
        print(f"Accounts created before activation: {len(ids)}")
        for k, v in sorted(outcome.items()):
            print(f"  {k}: {v}")
        if not args.apply:
            print("Dry run: nothing changed.")
            return 0
        if args.confirm != outcome["eligible"]:
            print(f"Refusing: --confirm {args.confirm} does not match {outcome['eligible']} eligible accounts.")
            return 2
        done = Counter()
        for pid in ids:
            service._lock_account(db, pid)
            done[beta.grant(db, pid, activation, now) or "granted"] += 1
            db.commit()
        print("Applied:", dict(done))
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    sys.exit(main())
