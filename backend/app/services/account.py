"""Account self-service: profile, data export and permanent deletion.

Every query is scoped to the caller's UUID. Storage is removed only under prefixes that
contain that UUID (``users/{uid}/``, ``keras/{uid}/``, ``uploads/{uid}/`` and the local
``runs/{uid}``, ``datasets/{uid}`` and model directories), so another user's files are
never addressed. Legacy flat run directories are removed only when their
``pipeline_runs`` row belongs to the caller.
"""

from __future__ import annotations

import logging
import shutil
import threading
import uuid
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional

from sqlalchemy import text

from app.config import APP_PROFILE, BOT_DATA_DIR, MODEL_BUCKET, MODEL_STORAGE_ROOT
from app.db import SessionLocal, engine
from app.models import (
    AssetLabel,
    Bot,
    BotEquitySnapshot,
    BotRun,
    BotTrade,
    CreditAccount,
    CreditLedgerEntry,
    DeletedAccount,
    PipelineRun,
    Profile,
    UserDataset,
    UserModel,
    UserPlan,
)
from app.paths import canonical_user_id, datasets_root, runs_root, validate_id

logger = logging.getLogger(__name__)

EXPORT_FORMAT = "convolve-account-export/1"
# Must match TERMS_VERSION / PRIVACY_VERSION in src/features/legal/meta.ts.
TERMS_VERSION = "2026-10-24"
PRIVACY_VERSION = "2026-10-24"
GCS_PREFIXES = ("users/{uid}/", "keras/{uid}/", "uploads/{uid}/")

# Per-process cache only. The durable record is the deleted_accounts table, which
# app.auth.ensure_profile consults whenever a token's profile row is missing.
_deleted_lock = threading.Lock()
_deleted_users: set[str] = set()


def is_deleted_user(user_id: str) -> bool:
    with _deleted_lock:
        return user_id in _deleted_users


def mark_deleted_in_memory(user_id: str) -> None:
    with _deleted_lock:
        _deleted_users.add(user_id)


def forget_deleted_in_memory() -> None:
    """Drop the cache, as a process restart would."""
    with _deleted_lock:
        _deleted_users.clear()


def _iso(value: Any) -> Any:
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, uuid.UUID):
        return str(value)
    return value


def _row(obj: Any, exclude: tuple[str, ...] = ()) -> Dict[str, Any]:
    return {c.name: _iso(getattr(obj, c.name)) for c in obj.__table__.columns if c.name not in exclude}


# --------------------------------------------------------------------------- profile


def get_profile(user_id: str) -> Dict[str, Any]:
    from app.services.credits import plan_state

    uid = uuid.UUID(user_id)
    db = SessionLocal()
    try:
        p = db.get(Profile, uid)
        counts = {
            "runs": db.query(PipelineRun).filter(PipelineRun.user_id == uid).count(),
            "datasets": db.query(UserDataset).filter(UserDataset.user_id == uid).count(),
            "models": db.query(UserModel).filter(UserModel.user_id == uid).count(),
            "bots": db.query(Bot).filter(Bot.user_id == user_id).count(),
        }
        return {
            "user_id": user_id,
            "email": p.email if p else None,
            "display_name": p.display_name if p else None,
            "created_at": _iso(p.created_at) if p else None,
            "terms": {
                "terms_version": p.terms_version if p else None,
                "privacy_version": p.privacy_version if p else None,
                "accepted_at": _iso(p.terms_accepted_at) if p else None,
                "current_terms_version": TERMS_VERSION,
                "current_privacy_version": PRIVACY_VERSION,
            },
            "plan": plan_state(db, uid),
            "counts": counts,
        }
    finally:
        db.close()


def accept_terms(user_id: str, terms_version: str, privacy_version: str) -> Dict[str, Any]:
    """Record acceptance of the current documents. Older or unknown versions are refused."""
    if terms_version != TERMS_VERSION or privacy_version != PRIVACY_VERSION:
        raise ValueError("These are not the current Terms and Privacy Policy versions")
    uid = uuid.UUID(user_id)
    db = SessionLocal()
    try:
        p = db.get(Profile, uid)
        if p is None:
            p = Profile(id=uid)
            db.add(p)
        p.terms_version = terms_version
        p.privacy_version = privacy_version
        p.terms_accepted_at = datetime.now(timezone.utc)
        db.commit()
    finally:
        db.close()
    return get_profile(user_id)


# --------------------------------------------------------------------------- onboarding

# Must match TOUR_STEPS in src/features/onboarding/steps.ts.
ONBOARDING_STEPS = ("generate", "train", "analyze", "backtest", "deploy", "monitor")
ONBOARDING_STATUSES = ("new", "active", "dismissed", "completed")


def _onboarding_default() -> Dict[str, Any]:
    return {"status": "new", "step": 0, "welcome_seen": False, "updated_at": None, "completed_at": None}


def get_onboarding(user_id: str) -> Dict[str, Any]:
    import json

    db = SessionLocal()
    try:
        p = db.get(Profile, uuid.UUID(user_id))
        raw = p.onboarding_json if p else None
    finally:
        db.close()
    state = _onboarding_default()
    if raw:
        try:
            stored = json.loads(raw)
            if isinstance(stored, dict):
                state.update({k: stored[k] for k in state if k in stored})
        except ValueError:
            logger.warning("Ignoring unreadable onboarding state for %s", user_id)
    state["steps"] = list(ONBOARDING_STEPS)
    return state


def save_onboarding(user_id: str, status: str, step: int, welcome_seen: bool) -> Dict[str, Any]:
    import json

    if status not in ONBOARDING_STATUSES:
        raise ValueError("Unknown onboarding status")
    if not 0 <= step < len(ONBOARDING_STEPS):
        raise ValueError("Unknown onboarding step")
    uid = uuid.UUID(user_id)
    now = datetime.now(timezone.utc).isoformat()
    previous = get_onboarding(user_id)
    state = {
        "status": status,
        "step": step,
        "welcome_seen": bool(welcome_seen or previous["welcome_seen"]),
        "updated_at": now,
        "completed_at": now if status == "completed" else previous.get("completed_at"),
    }
    db = SessionLocal()
    try:
        p = db.get(Profile, uid)
        if p is None:
            p = Profile(id=uid)
            db.add(p)
        p.onboarding_json = json.dumps(state)
        db.commit()
    finally:
        db.close()
    return {**state, "steps": list(ONBOARDING_STEPS)}


# --------------------------------------------------------------------------- usage

TERMINAL_FAILURES = ("failed", "interrupted")


def get_usage(user_id: str, weeks: int = 12, recent: int = 20) -> Dict[str, Any]:
    """Research activity from the caller's own pipeline_runs rows. No estimates."""
    from app.plans import TOOL_LABELS

    uid = uuid.UUID(user_id)
    db = SessionLocal()
    try:
        rows = (
            db.query(
                PipelineRun.id, PipelineRun.tool, PipelineRun.status, PipelineRun.route,
                PipelineRun.created_at, PipelineRun.finished_at, PipelineRun.error_summary,
            )
            .filter(PipelineRun.user_id == uid)
            .order_by(PipelineRun.created_at.desc())
            .all()
        )
        datasets = db.query(UserDataset).filter(UserDataset.user_id == uid).count()
        models = db.query(UserModel).filter(UserModel.user_id == uid).count()
        bots = db.query(Bot).filter(Bot.user_id == user_id).all()
    finally:
        db.close()

    def aware(value: Optional[datetime]) -> Optional[datetime]:
        if value is None:
            return None
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)

    by_tool: Dict[str, Dict[str, Any]] = {}
    status_totals: Dict[str, int] = {}
    compute_seconds = 0.0
    now = datetime.now(timezone.utc)
    week0 = (now - timedelta(days=now.weekday())).date()
    week_starts = [week0 - timedelta(weeks=i) for i in reversed(range(weeks))]
    weekly = {w.isoformat(): 0 for w in week_starts}
    for r in rows:
        item = by_tool.setdefault(
            r.tool,
            {"tool": r.tool, "label": TOOL_LABELS.get(r.tool, r.tool), "runs": 0, "succeeded": 0,
             "failed": 0, "cancelled": 0, "active": 0, "duration_seconds": 0.0},
        )
        item["runs"] += 1
        status = r.status or "unknown"
        status_totals[status] = status_totals.get(status, 0) + 1
        if status == "succeeded":
            item["succeeded"] += 1
        elif status in TERMINAL_FAILURES:
            item["failed"] += 1
        elif status == "cancelled":
            item["cancelled"] += 1
        else:
            item["active"] += 1
        created, finished = aware(r.created_at), aware(r.finished_at)
        if created and finished and finished >= created:
            secs = (finished - created).total_seconds()
            item["duration_seconds"] += secs
            compute_seconds += secs
        if created:
            wk = (created.date() - timedelta(days=created.weekday())).isoformat()
            if wk in weekly:
                weekly[wk] += 1

    return {
        "totals": {
            "runs": len(rows),
            "succeeded": status_totals.get("succeeded", 0),
            "failed": sum(status_totals.get(s, 0) for s in TERMINAL_FAILURES),
            "cancelled": status_totals.get("cancelled", 0),
            "active": sum(v for k, v in status_totals.items() if k in ("running", "queued")),
        },
        "by_tool": sorted(by_tool.values(), key=lambda x: -x["runs"]),
        "weekly": [{"week": k, "runs": v} for k, v in weekly.items()],
        "recent": [
            {
                "id": r.id,
                "tool": r.tool,
                "label": TOOL_LABELS.get(r.tool, r.tool),
                "status": r.status,
                "route": r.route,
                "created_at": _iso(r.created_at),
                "finished_at": _iso(r.finished_at),
                "error_summary": r.error_summary if r.status in TERMINAL_FAILURES else None,
            }
            for r in rows[:recent]
        ],
        "resources": {
            "datasets": datasets,
            "models": models,
            "bots": len(bots),
            "active_bots": sum(1 for b in bots if b.is_active),
            "run_seconds": round(compute_seconds),
        },
    }


def update_display_name(user_id: str, display_name: str) -> Dict[str, Any]:
    uid = uuid.UUID(user_id)
    db = SessionLocal()
    try:
        p = db.get(Profile, uid)
        if p is None:
            p = Profile(id=uid)
            db.add(p)
        p.display_name = display_name
        db.commit()
    finally:
        db.close()
    return get_profile(user_id)


# --------------------------------------------------------------------------- export


def export_account(user_id: str) -> Dict[str, Any]:
    """Everything stored about the caller in the database, as JSON-safe dicts."""
    from app.services.credits import ledger_rows_for_export, plan_state

    uid = uuid.UUID(user_id)
    db = SessionLocal()
    try:
        profile = db.get(Profile, uid)
        bots = db.query(Bot).filter(Bot.user_id == user_id).all()
        bot_ids = [b.id for b in bots]
        by_bot = lambda model: (  # noqa: E731
            [_row(r) for r in db.query(model).filter(model.bot_id.in_(bot_ids)).all()] if bot_ids else []
        )
        return {
            "format": EXPORT_FORMAT,
            "exported_at": datetime.now(timezone.utc).isoformat(),
            "profile": _row(profile) if profile else None,
            "research_runs": [
                _row(r, exclude=("worker_id",))
                for r in db.query(PipelineRun).filter(PipelineRun.user_id == uid).order_by(PipelineRun.created_at)
            ],
            "datasets": [_row(r, exclude=("path",)) for r in db.query(UserDataset).filter(UserDataset.user_id == uid)],
            "models": [
                _row(r, exclude=("path", "storage_key")) for r in db.query(UserModel).filter(UserModel.user_id == uid)
            ],
            "asset_labels": [_row(r) for r in db.query(AssetLabel).filter(AssetLabel.user_id == uid)],
            "bots": [_row(b, exclude=("model_path",)) for b in bots],
            "bot_runs": by_bot(BotRun),
            "bot_trades": by_bot(BotTrade),
            "bot_equity_snapshots": by_bot(BotEquitySnapshot),
            "plan": plan_state(db, uid),
            "credit_balance": int(acct.balance) if (acct := db.get(CreditAccount, uid)) else 0,
            "credit_ledger": ledger_rows_for_export(db, uid),
            "notes": [
                "Model files, chart images and report files are not embedded; download them from the workspace.",
                "Workspace preferences kept in your browser's local storage are not included.",
            ],
        }
    finally:
        db.close()


# --------------------------------------------------------------------------- deletion


def _gcs_delete_prefixes(user_id: str) -> int:
    from google.cloud import storage

    bucket = storage.Client().bucket(MODEL_BUCKET)
    n = 0
    for tmpl in GCS_PREFIXES:
        prefix = tmpl.format(uid=user_id)
        for blob in bucket.list_blobs(prefix=prefix):
            blob.delete()
            n += 1
    return n


def _gcs_delete_key(key: str) -> int:
    from google.cloud import storage

    blob = storage.Client().bucket(MODEL_BUCKET).blob(key)
    if blob.exists():
        blob.delete()
        return 1
    return 0


def _bot_model_key(bot: Bot, user_id: str) -> Optional[str]:
    """Legacy per-bot model keys that are safe to remove: they belong to this bot only."""
    path = (bot.model_path or "").strip()
    prefix = f"gcs://{MODEL_BUCKET}/"
    if not path.startswith(prefix):
        return None
    key = path[len(prefix):]
    if key.startswith(f"keras/{user_id}/"):
        return None  # covered by the prefix sweep
    if key in (f"models/{bot.id}.keras", f"keras/{bot.id}.keras"):
        return key
    return None


def _rm_tree(path: Path) -> int:
    if path.is_dir():
        shutil.rmtree(path)
        return 1
    if path.is_file():
        path.unlink()
        return 1
    return 0


def _delete_auth_user(user_id: str) -> str:
    if engine.dialect.name != "postgresql":
        return "skipped (no Supabase Auth schema in this environment)"
    with engine.begin() as conn:
        result = conn.execute(text("delete from auth.users where id = :id"), {"id": user_id})
    return "deleted" if result.rowcount else "not found"


def _remove_tombstone(uid: uuid.UUID) -> int:
    db = SessionLocal()
    try:
        n = db.query(DeletedAccount).filter(DeletedAccount.user_id == uid).delete(synchronize_session=False)
        db.commit()
        return n
    finally:
        db.close()


def delete_account(
    user_id: str,
    *,
    gcs_prefix_delete: Optional[Callable[[str], int]] = None,
    gcs_key_delete: Optional[Callable[[str], int]] = None,
) -> Dict[str, Any]:
    """Permanently remove the caller's data. Each step reports its own outcome."""
    uid = uuid.UUID(user_id)
    canonical = canonical_user_id(user_id)
    steps: List[Dict[str, Any]] = []
    ok = True

    def step(name: str, fn: Callable[[], Any]) -> Any:
        nonlocal ok
        try:
            detail = fn()
            steps.append({"step": name, "ok": True, "detail": detail})
            return detail
        except Exception as exc:  # report, never pretend
            ok = False
            logger.exception("account deletion step %s failed for %s", name, user_id)
            steps.append({"step": name, "ok": False, "detail": type(exc).__name__})
            return None

    db = SessionLocal()
    try:
        bots = db.query(Bot).filter(Bot.user_id == user_id).all()
        bot_ids = [b.id for b in bots]
        run_ids = [r.id for r in db.query(PipelineRun.id).filter(PipelineRun.user_id == uid)]
        legacy_keys = [k for k in (_bot_model_key(b, user_id) for b in bots) if k]

        def stop_bots() -> int:
            for b in bots:
                b.is_active = False
                b.lifecycle_state = "deleted"
            db.commit()
            return len(bots)

        step("stop_bots", stop_bots)

        if APP_PROFILE == "cloud" and MODEL_BUCKET:
            prefix_fn = gcs_prefix_delete or _gcs_delete_prefixes
            key_fn = gcs_key_delete or _gcs_delete_key
            step("cloud_storage", lambda: prefix_fn(user_id) + sum(key_fn(k) for k in legacy_keys))

        def local_files() -> int:
            n = _rm_tree(runs_root() / canonical)
            n += _rm_tree(datasets_root() / canonical)
            n += _rm_tree(Path(MODEL_STORAGE_ROOT) / canonical)
            n += _rm_tree(Path(BOT_DATA_DIR) / "models" / canonical)
            for rid in run_ids:
                try:
                    n += _rm_tree(runs_root() / validate_id(rid, kind="run"))
                    n += _rm_tree(runs_root() / "backtests" / validate_id(rid, kind="run"))
                except Exception:
                    continue
            return n

        step("local_files", local_files)

        def db_rows() -> Dict[str, int]:
            counts: Dict[str, int] = {}
            if bot_ids:
                for model in (BotTrade, BotEquitySnapshot, BotRun):
                    counts[model.__tablename__] = (
                        db.query(model).filter(model.bot_id.in_(bot_ids)).delete(synchronize_session=False)
                    )
            counts["bots"] = db.query(Bot).filter(Bot.user_id == user_id).delete(synchronize_session=False)
            for model in (
                AssetLabel, UserModel, UserDataset, PipelineRun, CreditLedgerEntry, CreditAccount, UserPlan,
            ):
                counts[model.__tablename__] = (
                    db.query(model).filter(model.user_id == uid).delete(synchronize_session=False)
                )
            counts["profiles"] = db.query(Profile).filter(Profile.id == uid).delete(synchronize_session=False)
            if db.get(DeletedAccount, uid) is None:
                db.add(DeletedAccount(user_id=uid))
            db.commit()
            return counts

        step("database", db_rows)
    finally:
        db.close()

    if ok:
        step("auth_user", lambda: _delete_auth_user(user_id))
    if not ok:
        # The sign-in identity still exists; let the user sign in again and retry.
        step("restore_sign_in", lambda: _remove_tombstone(uid))
    if ok:
        mark_deleted_in_memory(user_id)
    logger.info("account deletion for %s finished ok=%s steps=%s", user_id, ok, [s["step"] for s in steps])
    return {"ok": ok, "steps": steps}
