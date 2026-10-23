"""Write dev-only UI fixtures for the fleet Overview from the real aggregation code.

Synthetic fleets (0/1/3/12 bots) are built in a throwaway SQLite database. ``--real-db`` additionally
dumps the bots of one owner scope from a *copy* of a local database. Nothing touches app.db.

    python scripts/make_fleet_fixtures.py --out ../src/features/fleet/fixtures [--real-db /tmp/copy.db --real-owner local-user]
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import tempfile
import uuid
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

_fd, _tmp = tempfile.mkstemp(suffix=".db")
os.close(_fd)
os.environ["DATABASE_URL"] = f"sqlite:///{_tmp}"
os.environ.setdefault("CONVOLVE_TEST", "1")
os.environ.setdefault("AUTH_REQUIRED", "true")

from sqlalchemy import create_engine  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402

from app.db import SessionLocal, init_db  # noqa: E402
import app.ownership as ownership  # noqa: E402
from app.services.fleet import RANGES, build_fleet  # noqa: E402
from app.services.fleet_db import load_fleet_inputs  # noqa: E402
from tests.fleet_fixture_data import build_fleet_fixture  # noqa: E402


def dump(db, owner: str, out: Path, name: str, now: datetime) -> None:
    bots, excluded = load_fleet_inputs(db, owner, now)
    for rng in RANGES:
        payload = build_fleet(bots, now=now, rng=rng, poll_interval_s=60, excluded_lifecycle_counts=excluded)
        (out / f"{name}.{rng}.json").write_text(json.dumps(payload, separators=(",", ":")))
    print(f"{name}: {len(bots)} bots")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--real-db")
    ap.add_argument("--real-owner", default="local-user")
    a = ap.parse_args()
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    init_db()
    now = datetime.now(timezone.utc)
    for n in (0, 1, 3, 12):
        owner = str(uuid.uuid4())
        db = SessionLocal()
        try:
            build_fleet_fixture(db, owner, n, now)
            dump(db, owner, out, f"fleet{n}", now)
        finally:
            db.close()
    if a.real_db:
        ownership.AUTH_REQUIRED = False
        ownership.USER_ID = a.real_owner
        db = sessionmaker(bind=create_engine(f"sqlite:///{a.real_db}"))()
        try:
            dump(db, a.real_owner, out, "real", now)
        finally:
            db.close()


if __name__ == "__main__":
    main()
