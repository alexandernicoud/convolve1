"""Administrator overview: signups, accounts, activity, inbox counts.

Read-only. Account emails come from Supabase ``auth.users`` when the database role may read it
(so people who signed up but never opened the workspace are listed too), otherwise from
``profiles``, which is filled on the first authenticated request.
"""

from __future__ import annotations

import logging
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from sqlalchemy import func, text

from app.db import SessionLocal, engine
from app.models import (
    Bot,
    CitationClaim,
    ContactMessage,
    CreditAccount,
    FeedbackResponse,
    PipelineRun,
    Profile,
    Referral,
    UserDataset,
    UserModel,
)

logger = logging.getLogger(__name__)


def _iso(dt: Optional[datetime]) -> Optional[str]:
    return dt.isoformat() if dt else None


def _aware(dt: Optional[datetime]) -> Optional[datetime]:
    if dt is None:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def _auth_users() -> Optional[Dict[str, Dict[str, Any]]]:
    """Supabase accounts, or None when ``auth.users`` is not readable (SQLite, missing grant)."""
    if engine.dialect.name == "sqlite":
        return None
    try:
        with engine.connect() as conn:
            rows = conn.execute(text(
                "select id, email, created_at, last_sign_in_at, email_confirmed_at, "
                "coalesce(raw_app_meta_data->>'provider', '') as provider from auth.users"
            )).mappings().all()
    except Exception as exc:  # noqa: BLE001 - optional source; profiles are the fallback
        logger.info("auth.users not readable for the admin overview: %s", type(exc).__name__)
        return None
    return {
        str(r["id"]): {
            "email": r["email"], "created_at": _aware(r["created_at"]), "last_sign_in_at": _aware(r["last_sign_in_at"]),
            "confirmed": r["email_confirmed_at"] is not None, "provider": r["provider"] or None,
        }
        for r in rows
    }


def overview(now: Optional[datetime] = None) -> Dict[str, Any]:
    now = now or datetime.now(timezone.utc)
    db = SessionLocal()
    try:
        profiles = db.query(Profile).all()
        runs = db.query(PipelineRun.user_id, PipelineRun.tool, PipelineRun.status, PipelineRun.created_at).all()
        datasets = _by_user(db.query(UserDataset.user_id, func.count()).group_by(UserDataset.user_id).all())
        models = _by_user(db.query(UserModel.user_id, func.count()).group_by(UserModel.user_id).all())
        bots = _by_user(db.query(Bot.user_id, func.count()).group_by(Bot.user_id).all())
        balances = _by_user(db.query(CreditAccount.user_id, CreditAccount.balance).all())
        feedback_users = {str(u) for (u,) in db.query(FeedbackResponse.user_id).all()}
        referrals = Counter(str(r) for (r,) in db.query(Referral.referrer_id).all())
        contact_total = db.query(func.count(ContactMessage.id)).scalar() or 0
        contact_week = db.query(func.count(ContactMessage.id)).filter(ContactMessage.created_at >= now - timedelta(days=7)).scalar() or 0
        citations_pending = db.query(func.count(CitationClaim.id)).filter(CitationClaim.status == "pending").scalar() or 0
        recent = (
            db.query(PipelineRun).order_by(PipelineRun.created_at.desc()).limit(60).all()
        )
    finally:
        db.close()

    auth = _auth_users()
    by_id: Dict[str, Dict[str, Any]] = {}
    for p in profiles:
        by_id[str(p.id)] = {
            "id": str(p.id), "email": p.email, "display_name": p.display_name, "created_at": _aware(p.created_at),
            "last_sign_in_at": None, "confirmed": None, "provider": None,
            "terms_accepted": p.terms_accepted_at is not None, "opened_workspace": True,
        }
    for uid, a in (auth or {}).items():
        row = by_id.setdefault(uid, {"id": uid, "display_name": None, "terms_accepted": False, "opened_workspace": False})
        row.update({k: v for k, v in a.items() if v is not None or k not in row})
        row["email"] = a["email"] or row.get("email")

    per_user_runs: Dict[str, Counter] = defaultdict(Counter)
    last_activity: Dict[str, datetime] = {}
    tools: Dict[str, Counter] = defaultdict(Counter)
    for uid, tool, status, created in runs:
        key = str(uid) if uid else "anonymous"
        per_user_runs[key][status or "unknown"] += 1
        tools[tool or "unknown"][status or "unknown"] += 1
        created = _aware(created)
        if created and (key not in last_activity or created > last_activity[key]):
            last_activity[key] = created

    users: List[Dict[str, Any]] = []
    for uid, u in by_id.items():
        c = per_user_runs.get(uid, Counter())
        users.append({
            **u,
            "created_at": _iso(u.get("created_at")),
            "last_sign_in_at": _iso(u.get("last_sign_in_at")),
            "last_activity": _iso(last_activity.get(uid)),
            "runs": sum(c.values()), "runs_succeeded": c.get("succeeded", 0), "runs_failed": c.get("failed", 0),
            "datasets": datasets.get(uid, 0), "models": models.get(uid, 0), "bots": bots.get(uid, 0),
            "credits": balances.get(uid, 0), "feedback_done": uid in feedback_users,
            "referrals": referrals.get(uid, 0),
        })
    users.sort(key=lambda r: r["created_at"] or "", reverse=True)

    def created_within(days: int) -> int:
        cutoff = now - timedelta(days=days)
        return sum(1 for u in by_id.values() if u.get("created_at") and u["created_at"] >= cutoff)

    daily: Counter = Counter()
    for u in by_id.values():
        if u.get("created_at") and u["created_at"] >= now - timedelta(days=30):
            daily[u["created_at"].date().isoformat()] += 1
    signups_daily = [
        {"date": (now - timedelta(days=d)).date().isoformat(), "count": daily.get((now - timedelta(days=d)).date().isoformat(), 0)}
        for d in range(29, -1, -1)
    ]
    run_week = sum(1 for _, _, _, c in runs if _aware(c) and _aware(c) >= now - timedelta(days=7))
    emails = {uid: u.get("email") for uid, u in by_id.items()}

    return {
        "generated_at": now.isoformat(),
        "source": "auth.users" if auth is not None else "profiles",
        "totals": {
            "accounts": len(by_id),
            "signups_7d": created_within(7),
            "signups_30d": created_within(30),
            "active_7d": sum(1 for uid, t in last_activity.items() if uid != "anonymous" and t >= now - timedelta(days=7)),
            "opened_workspace": sum(1 for u in by_id.values() if u.get("opened_workspace")),
            "ran_experiment": sum(1 for uid in by_id if per_user_runs.get(uid)),
            "runs": len(runs), "runs_7d": run_week,
            "feedback": len(feedback_users),
            "contact_messages": contact_total, "contact_messages_7d": contact_week,
            "citations_pending": citations_pending,
        },
        "signups_daily": signups_daily,
        "tools": [{"tool": t, "total": sum(c.values()), **dict(c)} for t, c in sorted(tools.items(), key=lambda x: -sum(x[1].values()))],
        "users": users,
        "recent_runs": [
            {"id": r.id, "tool": r.tool, "status": r.status, "stage": r.stage, "error": r.error_summary,
             "email": emails.get(str(r.user_id)) if r.user_id else None,
             "created_at": _iso(_aware(r.created_at)), "finished_at": _iso(_aware(r.finished_at))}
            for r in recent
        ],
    }


def _by_user(rows: List[Any]) -> Dict[str, int]:
    return {str(k).lower(): int(v or 0) for k, v in rows if k is not None}
