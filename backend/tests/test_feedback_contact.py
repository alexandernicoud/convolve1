"""Feedback questionnaire (one atomic 5-credit grant per verified account) and the contact form."""

from __future__ import annotations

import threading
import uuid

import pytest
from fastapi import HTTPException

from app import config
from app.billing import lots, service
from app.db import SessionLocal
from app.main import register_run
from app.models import ContactMessage, CreditLedgerEntry, CreditLot, FeedbackResponse, PipelineRun
from app.services import account, contact, feedback
from tests.conftest import mint_token

ANSWERS = {
    "role": "quant",
    "experience": "3_10",
    "goal": "patterns",
    "tools_used": ["datasets", "training", "backtesting"],
    "overall": 2,
    "recommend": 6,
    "most_useful": "backtesting",
    "biggest_problem": "slow",
    "first_result": "15_60",
    "results_trust": "some",
    "missing": ["intraday", "export"],
    "alternative": "python",
    "fair_price": "5_15",
    "disappointed": "somewhat",
    "continue_use": "unsure",
    "improve": "Show training time estimates.",
    "confusing": "The labeling rule at first.",
}


def _h(user: uuid.UUID, **claims) -> dict:
    return {"Authorization": f"Bearer {mint_token(user, **claims)}"}


def _balance(user: uuid.UUID) -> int:
    db = SessionLocal()
    try:
        return lots.breakdown(db, user)["total"]
    finally:
        db.close()


def _grants(user: uuid.UUID) -> list:
    db = SessionLocal()
    try:
        return [(l.kind, l.credits_total, l.amount_minor) for l in db.query(CreditLot).filter(CreditLot.user_id == user)]
    finally:
        db.close()


# --------------------------------------------------------------------------- questionnaire


def test_definition_lists_every_question_and_explains_the_bonus(client, user_a):
    r = client.get("/api/feedback", headers=_h(user_a))
    assert r.status_code == 200
    body = r.json()
    assert [q["id"] for q in body["questions"]] == list(ANSWERS)
    assert body["bonus_credits"] == 5 and body["completed"] is False


def test_completed_questionnaire_grants_exactly_five_promotional_credits_once(client, user_a):
    h = _h(user_a)
    r = client.post("/api/feedback", json={"answers": ANSWERS}, headers=h)
    assert r.status_code == 200 and r.json() == {"completed": True, "credits_granted": 5}
    assert _grants(user_a) == [("grant", 5, None)]  # no amount paid: never cash-refundable
    assert _balance(user_a) == 5

    again = client.post("/api/feedback", json={"answers": ANSWERS}, headers=h)
    assert again.status_code == 409 and again.json()["detail"]["code"] == "already_completed"
    assert _balance(user_a) == 5
    assert client.get("/api/feedback", headers=h).json()["completed"] is True

    db = SessionLocal()
    try:
        entries = [(e.reason, e.delta) for e in db.query(CreditLedgerEntry).filter(CreditLedgerEntry.user_id == user_a)]
    finally:
        db.close()
    assert entries == [("grant", 5)]


def test_concurrent_submissions_grant_once(user_a):
    results: list = []
    barrier = threading.Barrier(6)

    def go():
        barrier.wait()
        try:
            results.append(feedback.submit(str(user_a), ANSWERS)["credits_granted"])
        except HTTPException as exc:
            results.append(exc.status_code)
        except Exception as exc:  # SQLite may refuse a concurrent writer outright; it must not grant
            results.append(type(exc).__name__)

    threads = [threading.Thread(target=go) for _ in range(6)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert results.count(5) == 1
    assert _balance(user_a) == 5
    db = SessionLocal()
    try:
        assert db.query(FeedbackResponse).filter(FeedbackResponse.user_id == user_a).count() == 1
        assert db.query(CreditLot).filter(CreditLot.user_id == user_a).count() == 1
    finally:
        db.close()


@pytest.mark.parametrize("change", [
    {"overall": 6}, {"overall": True}, {"recommend": 11}, {"recommend": -1}, {"most_useful": "crypto"},
    {"continue_use": None}, {"biggest_problem": "everything"}, {"improve": "x" * 2001}, {"improve": "meh"},
    {"extra": "field"}, {"tools_used": []}, {"tools_used": "training"}, {"tools_used": ["training", "training"]},
    {"missing": ["teleport"]},
])
def test_invalid_or_incomplete_answers_grant_nothing(client, user_a, change):
    answers = {**ANSWERS, **change}
    r = client.post("/api/feedback", json={"answers": answers}, headers=_h(user_a))
    assert r.status_code == 422
    assert _balance(user_a) == 0 and _grants(user_a) == []


def test_missing_answer_is_refused(client, user_a):
    answers = {k: v for k, v in ANSWERS.items() if k != "results_trust"}
    assert client.post("/api/feedback", json={"answers": answers}, headers=_h(user_a)).status_code == 422


def test_the_main_suggestion_is_required_and_the_second_is_optional(client, user_a):
    without = {k: v for k, v in ANSWERS.items() if k != "improve"}
    assert client.post("/api/feedback", json={"answers": without}, headers=_h(user_a)).status_code == 422
    answers = {k: v for k, v in ANSWERS.items() if k != "confusing"}
    r = client.post("/api/feedback", json={"answers": {**answers, "confusing": "  "}}, headers=_h(user_a))
    assert r.status_code == 200 and _balance(user_a) == 5


def test_multiple_choice_answers_are_stored_in_option_order(user_a):
    feedback.submit(str(user_a), {**ANSWERS, "tools_used": ["backtesting", "datasets"]})
    db = SessionLocal()
    try:
        row = db.query(FeedbackResponse).filter(FeedbackResponse.user_id == user_a).one()
    finally:
        db.close()
    import json

    assert json.loads(row.answers_json)["tools_used"] == ["datasets", "backtesting"]


@pytest.mark.parametrize("claims", [{"is_anonymous": True}, {"email": None},
                                    {"user_metadata": {"email_verified": False}}])
def test_unverified_or_anonymous_accounts_cannot_claim(client, user_a, claims):
    r = client.post("/api/feedback", json={"answers": ANSWERS}, headers=_h(user_a, **claims))
    assert r.status_code == 403 and r.json()["detail"]["code"] == "verification_required"
    assert _balance(user_a) == 0


def test_signed_out_requests_are_refused(client):
    assert client.post("/api/feedback", json={"answers": ANSWERS}).status_code == 401


def test_bonus_credits_are_never_offered_as_a_cash_refund(monkeypatch, user_a):
    monkeypatch.setattr(config, "BILLING_MODE", "sandbox")
    monkeypatch.setattr(config, "BILLING_PROVIDER", "simulator")
    feedback.submit(str(user_a), ANSWERS)
    assert service.refund_quote(user_a)["lots"] == []


def test_admin_can_read_responses_and_others_cannot(client, monkeypatch, user_a, user_b):
    feedback.submit(str(user_a), ANSWERS)
    assert client.get("/api/admin/feedback", headers=_h(user_b)).status_code == 404
    monkeypatch.setattr(config, "ADMIN_USER_IDS", frozenset({str(user_b)}))
    r = client.get("/api/admin/feedback", headers=_h(user_b))
    assert r.status_code == 200
    assert str(user_a) not in r.text  # pseudonymous: no account id or email
    mine = [x for x in r.json()["responses"] if x["respondent"] == feedback._respondent(user_a)]
    assert mine and mine[0]["answers"] == ANSWERS and mine[0]["credits_granted"] == 5


def test_admin_csv_export_is_pseudonymous_and_formula_safe(client, monkeypatch, user_a, user_b):
    feedback.submit(str(user_a), {**ANSWERS, "improve": "=HYPERLINK(\"http://x\")"})
    assert client.get("/api/admin/feedback.csv", headers=_h(user_b)).status_code == 404
    monkeypatch.setattr(config, "ADMIN_USER_IDS", frozenset({str(user_b)}))
    r = client.get("/api/admin/feedback.csv", headers=_h(user_b))
    assert r.status_code == 200 and r.headers["content-type"].startswith("text/csv")
    assert str(user_a) not in r.text and "Runs took too long" in r.text
    assert "Intraday timeframes; API or Python export" in r.text
    assert "'=HYPERLINK" in r.text


# --------------------------------------------------------------------------- required after two experiments


def _runs(user: uuid.UUID, *statuses: str, tool: str = "trainer") -> None:
    db = SessionLocal()
    try:
        for s in statuses:
            db.add(PipelineRun(id=f"fb_{uuid.uuid4().hex[:12]}", user_id=user, tool=tool, status=s))
        db.commit()
    finally:
        db.close()


def _start(user: uuid.UUID, tool: str = "trainer") -> None:
    run_id = f"fb_{uuid.uuid4().hex[:12]}"
    register_run(run_id, tool, f"/x/{run_id}", user_id=str(user), status="running")


def test_questionnaire_is_required_after_two_successful_experiments(client, monkeypatch, user_a):
    monkeypatch.setattr(config, "FEEDBACK_REQUIRED_AFTER_RUNS", 2)
    _runs(user_a, "succeeded", "failed", "cancelled", "interrupted")
    _start(user_a)  # one success so far: not required
    _runs(user_a, "succeeded")
    with pytest.raises(HTTPException) as exc:
        _start(user_a, "backtester")
    assert exc.value.status_code == 403 and exc.value.detail["code"] == "feedback_required"
    st = client.get("/api/feedback", headers=_h(user_a)).json()
    assert st["gate"] == {"threshold": 2, "completed_experiments": 2, "required": True}

    # Saved results, account, privacy and deletion stay reachable while the gate is on.
    for path in ("/api/me", "/api/account/export", "/api/feedback"):
        assert client.get(path, headers=_h(user_a)).status_code == 200, path

    assert client.post("/api/feedback", json={"answers": ANSWERS}, headers=_h(user_a)).status_code == 200
    _start(user_a, "backtester")
    st = client.get("/api/feedback", headers=_h(user_a)).json()
    assert st["gate"]["required"] is False
    assert st["reward"]["credits"] == 5 and st["reward"]["usable_now"] is False


def test_analysing_an_existing_model_is_never_paused(monkeypatch, user_a):
    monkeypatch.setattr(config, "FEEDBACK_REQUIRED_AFTER_RUNS", 2)
    _runs(user_a, "succeeded", "succeeded")
    _start(user_a, "analysis")
    with pytest.raises(HTTPException):
        _start(user_a, "trainer")


def test_gate_is_off_without_a_threshold(monkeypatch, user_a):
    monkeypatch.setattr(config, "FEEDBACK_REQUIRED_AFTER_RUNS", 0)
    _runs(user_a, "succeeded", "succeeded", "succeeded")
    _start(user_a)


def test_reward_is_never_granted_twice(user_a):
    feedback.submit(str(user_a), ANSWERS)
    db = SessionLocal()
    try:
        assert lots.add_lot(db, user_a, kind="grant", source_key=f"feedback:{user_a}", credits=5, reason="grant",
                            note="again") is None
        db.rollback()
    finally:
        db.close()
    assert _balance(user_a) == 5


def test_export_includes_and_deletion_removes_the_response(user_a):
    feedback.submit(str(user_a), ANSWERS)
    assert account.export_account(str(user_a))["feedback_questionnaire"]["answers"] == ANSWERS
    assert account.delete_account(str(user_a))["ok"]
    db = SessionLocal()
    try:
        assert db.query(FeedbackResponse).filter(FeedbackResponse.user_id == user_a).count() == 0
    finally:
        db.close()


# --------------------------------------------------------------------------- contact form


def _msg(**over) -> dict:
    n = uuid.uuid4().hex[:8]
    return {"name": "Ada", "email": f"ada.{n}@example.org", "message": "I would like to talk about investing.",
            "topic": "investing", "website": "", "elapsed_ms": 8000, **over}


def _stored(email: str) -> list:
    db = SessionLocal()
    try:
        return db.query(ContactMessage).filter(ContactMessage.email == email.lower()).all()
    finally:
        db.close()


def test_contact_message_is_stored_without_sign_in(client):
    body = _msg()
    r = client.post("/api/contact", json=body, headers={"x-forwarded-for": f"203.0.113.{uuid.uuid4().int % 250}"})
    assert r.status_code == 200 and r.json() == {"ok": True}
    rows = _stored(body["email"])
    assert len(rows) == 1 and rows[0].message == body["message"] and rows[0].topic == "investing"
    assert rows[0].ip_hash and "203.0.113" not in rows[0].ip_hash


def test_honeypot_submissions_look_accepted_but_are_dropped(client):
    body = _msg(website="http://spam.example")
    assert client.post("/api/contact", json=body).status_code == 200
    assert _stored(body["email"]) == []


@pytest.mark.parametrize("over,status", [
    ({"elapsed_ms": 500}, 429),
    ({"email": "not-an-email"}, 422),
    ({"name": "  "}, 422),
    ({"message": "hi"}, 422),
    ({"message": "x" * 5001}, 422),
    ({"message": "see http://a.example http://b.example http://c.example http://d.example"}, 422),
])
def test_invalid_or_suspicious_messages_are_refused(client, over, status):
    body = _msg(**over)
    assert client.post("/api/contact", json=body).status_code == status
    assert _stored(body["email"]) == []


def test_contact_is_rate_limited_per_address(client, monkeypatch):
    monkeypatch.setattr(config, "CONTACT_MAX_PER_HOUR", 2)
    ip = {"x-forwarded-for": f"198.51.100.{uuid.uuid4().int % 250}"}
    codes = [client.post("/api/contact", json=_msg(), headers=ip).status_code for _ in range(3)]
    assert codes == [200, 200, 429]


def test_notification_is_skipped_without_a_provider_and_admin_sees_messages(client, monkeypatch, user_b):
    monkeypatch.setattr(config, "RESEND_API_KEY", "")
    body = _msg()
    client.post("/api/contact", json=body)
    contact.notify(str(_stored(body["email"])[0].id))  # no provider configured: no network, no error
    assert client.get("/api/admin/contact", headers=_h(user_b)).status_code == 404
    monkeypatch.setattr(config, "ADMIN_USER_IDS", frozenset({str(user_b)}))
    msgs = client.get("/api/admin/contact", headers=_h(user_b)).json()["messages"]
    assert any(m["email"] == body["email"] and m["notified"] is False for m in msgs)
    assert all("ip_hash" not in m for m in msgs)
