"""Feedback questionnaire: one completed response per verified account, 5 promotional credits.

The response row and its credit lot are written in one transaction. Both carry a unique key
(``feedback_responses.user_id`` and ``credit_lots.source_key``), so a repeated or concurrent
submission can never grant twice: the loser's transaction fails on the constraint and is
rolled back whole. Bonus credits are a ``grant`` lot: never cash-refundable, not transferable.
"""

from __future__ import annotations

import csv
import hashlib
import io
import json
import uuid
from typing import Any, Dict, List, Mapping, Optional

from fastapi import HTTPException
from sqlalchemy.exc import IntegrityError

from app import config
from app.billing import lots
from app.db import SessionLocal
from app.models import CreditAccount, CreditLot, FeedbackResponse, PipelineRun, Profile

SURVEY_VERSION = "2026-11-01"
BONUS_CREDITS = 5
TEXT_MAX = 2000

# Successful runs of these tools count as research experiments for the feedback gate.
GATED_TOOLS = frozenset({"training-chart-generator", "labeling-optimizer", "testdata", "trainer", "backtester", "analysis"})

FEATURES = [
    ("datasets", "Chart dataset generator"),
    ("training", "Model training"),
    ("analysis", "Model analysis (filters, attention, Lab)"),
    ("backtesting", "Backtesting"),
    ("bots", "Paper-trading bots"),
    ("labeling", "Labeling optimizer"),
    ("other", "Something else"),
]
VALUE = [
    ("excellent", "Excellent"),
    ("good", "Good"),
    ("fair", "Fair"),
    ("poor", "Poor"),
    ("not_paid", "I have not paid for Convolve"),
]

PROBLEMS = [
    ("setup", "Setting up an experiment was confusing"),
    ("slow", "Runs took too long"),
    ("errors", "Runs failed or showed errors"),
    ("interpret", "Results were hard to interpret"),
    ("data", "Symbols, timeframes or data I need are missing"),
    ("relevance", "It does not fit how I research"),
    ("none", "Nothing got in my way"),
]
TRUST = [
    ("high", "I would rely on them"),
    ("some", "Useful, but I would verify elsewhere"),
    ("low", "I do not trust them yet"),
    ("unsure", "Too early to say"),
]
CONTINUE = [
    ("definitely", "Definitely"),
    ("probably", "Probably"),
    ("unsure", "Not sure"),
    ("probably_not", "Probably not"),
    ("definitely_not", "Definitely not"),
]

ROLE = [
    ("retail", "Private trader or investor"),
    ("professional", "Professional trader or portfolio manager"),
    ("quant", "Quant, data scientist or ML engineer"),
    ("student", "Student or academic researcher"),
    ("developer", "Software developer"),
    ("other", "Something else"),
]
EXPERIENCE = [
    ("lt1", "Less than a year"),
    ("1_3", "1 to 3 years"),
    ("3_10", "3 to 10 years"),
    ("gt10", "More than 10 years"),
]
GOAL = [
    ("patterns", "Test whether chart patterns predict anything"),
    ("strategy", "Build a model I could trade with"),
    ("learn", "Learn how CNNs and deep learning work"),
    ("research", "Academic or professional research"),
    ("curious", "Just curious"),
]
TOOLS_USED = [f for f in FEATURES if f[0] != "other"]
FIRST_RESULT = [
    ("lt15", "Under 15 minutes"),
    ("15_60", "15 to 60 minutes"),
    ("1_3h", "1 to 3 hours"),
    ("longer", "Longer"),
    ("not_yet", "I have not got one yet"),
]
MISSING = [
    ("markets", "More markets (crypto, FX, futures)"),
    ("intraday", "Intraday timeframes"),
    ("own_data", "Upload my own price data"),
    ("indicators", "Indicators drawn on the charts"),
    ("live", "Live or broker trading"),
    ("export", "API or Python export"),
    ("compare", "Comparing models side by side"),
    ("learning", "Better explanations and tutorials"),
    ("nothing", "Nothing important"),
]
ALTERNATIVE = [
    ("charting", "Charting tools such as TradingView"),
    ("python", "My own Python notebooks"),
    ("quant_platform", "A quant platform such as QuantConnect"),
    ("other_ml", "Another no-code ML tool"),
    ("none", "Nothing: I would not do this research"),
]
PRICE = [
    ("free_only", "I would only use it for free"),
    ("lt5", "Up to US$5 a month"),
    ("5_15", "US$5 to 15"),
    ("15_30", "US$15 to 30"),
    ("30_60", "US$30 to 60"),
    ("gt60", "More than US$60"),
]
DISAPPOINTED = [
    ("very", "Very disappointed"),
    ("somewhat", "Somewhat disappointed"),
    ("not", "Not disappointed"),
]

QUESTIONS: List[Dict[str, Any]] = [
    {"id": "role", "type": "choice", "options": ROLE, "prompt": "What describes you best?"},
    {"id": "experience", "type": "choice", "options": EXPERIENCE, "prompt": "How long have you been trading or researching markets?"},
    {"id": "goal", "type": "choice", "options": GOAL, "prompt": "What did you come to Convolve to do?"},
    {"id": "tools_used", "type": "multi", "options": TOOLS_USED, "prompt": "Which tools did you actually use? Pick all that apply."},
    {"id": "overall", "type": "rating", "min": 1, "max": 5, "prompt": "How would you rate your experience so far?"},
    {"id": "recommend", "type": "rating", "min": 0, "max": 10,
     "prompt": "How likely are you to recommend Convolve to a friend or colleague?"},
    {"id": "most_useful", "type": "choice", "options": FEATURES, "prompt": "Which part was most useful?"},
    {"id": "biggest_problem", "type": "choice", "options": PROBLEMS, "prompt": "What got in your way the most?"},
    {"id": "first_result", "type": "choice", "options": FIRST_RESULT, "prompt": "How long did it take to get your first meaningful result?"},
    {"id": "results_trust", "type": "choice", "options": TRUST, "prompt": "How do you see the results you got?"},
    {"id": "missing", "type": "multi", "options": MISSING, "prompt": "What is missing for your research? Pick all that apply."},
    {"id": "alternative", "type": "choice", "options": ALTERNATIVE, "prompt": "What would you use if Convolve did not exist?"},
    {"id": "fair_price", "type": "choice", "options": PRICE, "prompt": "What monthly price would feel fair for what you have seen?"},
    {"id": "disappointed", "type": "choice", "options": DISAPPOINTED, "prompt": "How would you feel if you could no longer use Convolve?"},
    {"id": "continue_use", "type": "choice", "options": CONTINUE, "prompt": "Will you keep using Convolve for your research?"},
    {"id": "improve", "type": "text", "min_length": 10,
     "prompt": "If you could change one thing about Convolve, what would it be? Criticism is welcome."},
    {"id": "confusing", "type": "text", "min_length": 0, "optional": True,
     "prompt": "Anything that confused or surprised you? (optional)"},
]

# Questions of earlier versions, so stored answers stay readable.
LEGACY_QUESTIONS: Dict[str, List[Dict[str, Any]]] = {
    "2026-10-31": [
        {"id": "overall", "type": "rating", "min": 1, "max": 5, "prompt": "How would you rate your experience so far?"},
        {"id": "most_useful", "type": "choice", "options": FEATURES, "prompt": "Which part did you find most useful?"},
        {"id": "biggest_problem", "type": "choice", "options": PROBLEMS, "prompt": "What got in your way the most?"},
        {"id": "results_trust", "type": "choice", "options": TRUST, "prompt": "How do you see the results you got?"},
        {"id": "continue_use", "type": "choice", "options": CONTINUE, "prompt": "Will you keep using Convolve for your research?"},
        {"id": "improve", "type": "text", "min_length": 0, "optional": True,
         "prompt": "What should we improve first? Criticism is welcome. (optional)"},
    ],
    "2026-10-27": [
        {"id": "overall", "type": "rating", "min": 1, "max": 5,
         "prompt": "How would you rate your overall experience with Convolve?"},
        {"id": "most_useful", "type": "choice", "options": FEATURES, "prompt": "Which feature is most useful to you?"},
        {"id": "frustration", "type": "text", "min_length": 2, "prompt": "What is your biggest frustration with Convolve?"},
        {"id": "missing", "type": "text", "min_length": 2, "prompt": "What functionality is missing for your research?"},
        {"id": "value", "type": "choice", "options": VALUE, "prompt": "How do you rate Convolve's value for money?"},
        {"id": "suggestions", "type": "text", "min_length": 2, "prompt": "What would you improve first?"},
    ],
}


def _public(questions: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    return [
        {**q, "options": [{"id": i, "label": label} for i, label in q["options"]]} if "options" in q else q
        for q in questions
    ]


def definition() -> Dict[str, Any]:
    return {
        "version": SURVEY_VERSION,
        "bonus_credits": BONUS_CREDITS,
        "questions": _public(QUESTIONS),
    }


def _invalid(field: str, message: str) -> HTTPException:
    return HTTPException(status_code=422, detail={"code": "invalid_answer", "field": field, "message": message})


def validate(answers: Mapping[str, Any]) -> Dict[str, Any]:
    """Every question answered within its limits; unknown fields are refused."""
    if not isinstance(answers, Mapping):
        raise _invalid("answers", "Answers must be an object.")
    unknown = set(answers) - {q["id"] for q in QUESTIONS}
    if unknown:
        raise _invalid(sorted(unknown)[0], "Unknown question.")
    clean: Dict[str, Any] = {}
    for q in QUESTIONS:
        value = answers.get(q["id"])
        if q["type"] == "rating":
            if isinstance(value, bool) or not isinstance(value, int) or not q["min"] <= value <= q["max"]:
                raise _invalid(q["id"], f"Choose a rating from {q['min']} to {q['max']}.")
            clean[q["id"]] = value
        elif q["type"] == "choice":
            if value not in {i for i, _ in q["options"]}:
                raise _invalid(q["id"], "Choose one of the options.")
            clean[q["id"]] = value
        elif q["type"] == "multi":
            allowed = [i for i, _ in q["options"]]
            if not isinstance(value, list) or not value or len(set(value)) != len(value) or any(v not in allowed for v in value):
                raise _invalid(q["id"], "Choose at least one of the options.")
            clean[q["id"]] = [i for i in allowed if i in value]
        else:
            text = value.strip() if isinstance(value, str) else ""
            if q.get("optional") and not text:
                continue
            if len(text) < q["min_length"]:
                raise _invalid(q["id"], "Please answer this question.")
            if len(text) > TEXT_MAX:
                raise _invalid(q["id"], f"Keep this answer under {TEXT_MAX} characters.")
            clean[q["id"]] = text
    return clean


def _completed_experiments(db, uid: uuid.UUID) -> int:
    """Successful research runs only: failed, cancelled or interrupted runs do not count."""
    return (
        db.query(PipelineRun.id)
        .filter(PipelineRun.user_id == uid, PipelineRun.tool.in_(GATED_TOOLS), PipelineRun.status == "succeeded")
        .count()
    )


def _reward(db, uid: uuid.UUID) -> Optional[Dict[str, Any]]:
    lot = db.query(CreditLot).filter(CreditLot.source_key == f"feedback:{uid}").first()
    if lot is None:
        return None
    return {
        "credits": lot.credits_total,
        "remaining": lot.credits_remaining,
        # Credits are stored now and spendable only once runs are charged (credits switched on).
        "usable_now": config.CREDITS_MODE == "enforce",
        "granted_at": lot.created_at.isoformat() if lot.created_at else None,
    }


def gate(db, uid: uuid.UUID, completed: bool) -> Dict[str, Any]:
    threshold = config.FEEDBACK_REQUIRED_AFTER_RUNS
    runs = _completed_experiments(db, uid) if threshold else 0
    return {
        "threshold": threshold,
        "completed_experiments": runs,
        "required": bool(threshold) and not completed and runs >= threshold,
    }


def status(user_id: str) -> Dict[str, Any]:
    uid = uuid.UUID(user_id)
    db = SessionLocal()
    try:
        row = db.query(FeedbackResponse).filter(FeedbackResponse.user_id == uid).first()
        return {
            "completed": row is not None,
            "completed_at": row.created_at.isoformat() if row is not None and row.created_at else None,
            "credits_granted": row.credits_granted if row is not None else 0,
            "reward": _reward(db, uid),
            "gate": gate(db, uid, row is not None),
            **definition(),
        }
    finally:
        db.close()


def check_gate(user_id: Optional[str], tool: str) -> None:
    """Called before a compute run is registered. Only new runs are gated: results, downloads,
    account, privacy and deletion never are."""
    if not user_id or tool not in GATED_TOOLS or not config.FEEDBACK_REQUIRED_AFTER_RUNS:
        return
    try:
        uid = uuid.UUID(str(user_id))
    except ValueError:
        return
    db = SessionLocal()
    try:
        done = db.query(FeedbackResponse.id).filter(FeedbackResponse.user_id == uid).first() is not None
        state = gate(db, uid, done)
    finally:
        db.close()
    if state["required"]:
        raise HTTPException(status_code=403, detail={
            "code": "feedback_required",
            "message": ("You've now had a chance to try Convolve. Before your next experiment, tell us what works, "
                        "what doesn't, and what you'd improve."),
            "feedback_url": "/dashboard/feedback",
            "completed_experiments": state["completed_experiments"],
            "bonus_credits": BONUS_CREDITS,
        })


def submit(user_id: str, answers: Mapping[str, Any]) -> Dict[str, Any]:
    clean = validate(answers)
    uid = uuid.UUID(user_id)
    db = SessionLocal()
    try:
        if db.get(Profile, uid) is None:
            raise HTTPException(status_code=401, detail="Not authenticated")
        if db.get(CreditAccount, uid) is None:
            db.add(CreditAccount(user_id=uid, balance=0, version=1))
            db.flush()
        db.query(CreditAccount).filter(CreditAccount.user_id == uid).with_for_update().one()
        if db.query(FeedbackResponse.id).filter(FeedbackResponse.user_id == uid).first():
            raise _already()
        db.add(FeedbackResponse(user_id=uid, survey_version=SURVEY_VERSION, answers_json=json.dumps(clean),
                                credits_granted=BONUS_CREDITS))
        db.flush()
        lot = lots.add_lot(
            db, uid, kind="grant", source_key=f"feedback:{uid}", credits=BONUS_CREDITS, reason="grant",
            note=f"Feedback questionnaire bonus: {BONUS_CREDITS} promotional credits (non-refundable)",
        )
        if lot is None:
            raise _already()
        db.commit()
    except IntegrityError:
        db.rollback()
        raise _already()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()
    return {"completed": True, "credits_granted": BONUS_CREDITS}


def _already() -> HTTPException:
    return HTTPException(status_code=409, detail={
        "code": "already_completed", "message": "You have already completed the questionnaire. Thank you!"})


def _respondent(uid: uuid.UUID) -> str:
    """Stable pseudonym: the same account always maps to the same code, without exposing it."""
    return hashlib.sha256(f"feedback-respondent:{uid}".encode()).hexdigest()[:10]


def admin_list(limit: int = 200, offset: int = 0) -> Dict[str, Any]:
    """Answers without names, emails or account ids (data minimisation)."""
    db = SessionLocal()
    try:
        q = db.query(FeedbackResponse)
        total = q.count()
        rows = q.order_by(FeedbackResponse.created_at.desc()).offset(offset).limit(limit).all()
        return {
            "total": total,
            "questions": definition()["questions"],
            "questions_by_version": {SURVEY_VERSION: _public(QUESTIONS), **{v: _public(qs) for v, qs in LEGACY_QUESTIONS.items()}},
            "responses": [
                {"respondent": _respondent(r.user_id), "survey_version": r.survey_version,
                 "answers": json.loads(r.answers_json), "credits_granted": r.credits_granted,
                 "created_at": r.created_at.isoformat() if r.created_at else None}
                for r in rows
            ],
        }
    finally:
        db.close()


def _cell(value: Any) -> Any:
    """Free text cannot start a spreadsheet formula."""
    if isinstance(value, str) and value[:1] in ("=", "+", "-", "@", "\t", "\r"):
        return "'" + value
    return value


def admin_csv() -> str:
    """Current-version answers, one row per response, choice labels instead of ids."""
    data = admin_list(limit=100_000)
    labels = {q["id"]: {o["id"]: o["label"] for o in q.get("options", [])} for q in data["questions"]}
    ids = [q["id"] for q in data["questions"]]
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(["respondent", "submitted_at", "survey_version", *ids])
    for r in data["responses"]:
        if r["survey_version"] != SURVEY_VERSION:
            continue
        answers = r["answers"]

        def label(i: str) -> Any:
            v = answers.get(i, "")
            if isinstance(v, list):
                return "; ".join(labels[i].get(x, x) for x in v)
            return labels[i].get(v, v) if isinstance(v, str) else v

        writer.writerow([r["respondent"], r["created_at"], r["survey_version"], *[_cell(label(i)) for i in ids]])
    return buf.getvalue()


def export_for(db, uid: uuid.UUID) -> Optional[Dict[str, Any]]:
    row = db.query(FeedbackResponse).filter(FeedbackResponse.user_id == uid).first()
    if row is None:
        return None
    return {"survey_version": row.survey_version, "answers": json.loads(row.answers_json),
            "credits_granted": row.credits_granted, "created_at": row.created_at.isoformat() if row.created_at else None}
