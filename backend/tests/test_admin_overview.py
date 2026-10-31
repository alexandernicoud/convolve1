"""Administrator console: access by verified email, overview contents."""

from __future__ import annotations

import uuid

from app import config
from app.db import SessionLocal
from app.models import PipelineRun
from app.services import contact, feedback
from tests.conftest import mint_token
from tests.test_feedback_contact import ANSWERS

ADMIN_EMAIL = "founder@example.com"


def _h(user: uuid.UUID, **claims) -> dict:
    return {"Authorization": f"Bearer {mint_token(user, **claims)}"}


def test_overview_is_hidden_from_everyone_but_the_admin_email(client, monkeypatch, user_a, user_b):
    monkeypatch.setattr(config, "ADMIN_EMAILS", frozenset({ADMIN_EMAIL}))
    assert client.get("/api/admin/overview", headers=_h(user_a)).status_code == 404
    assert client.get("/api/admin/overview", headers=_h(user_b, email=ADMIN_EMAIL, user_metadata={"email_verified": False})).status_code in (403, 404)
    assert client.get("/api/admin/overview").status_code == 401
    assert client.get("/api/admin/overview", headers=_h(user_b, email=ADMIN_EMAIL.upper())).status_code == 200


def test_me_reports_admin_only_for_the_admin(client, monkeypatch, user_a, user_b):
    monkeypatch.setattr(config, "ADMIN_EMAILS", frozenset({ADMIN_EMAIL}))
    assert client.get("/api/me", headers=_h(user_a)).json()["is_admin"] is False
    assert client.get("/api/me", headers=_h(user_b, email=ADMIN_EMAIL)).json()["is_admin"] is True


def test_admin_email_also_opens_feedback_and_contact(client, monkeypatch, user_b):
    monkeypatch.setattr(config, "ADMIN_EMAILS", frozenset({ADMIN_EMAIL}))
    h = _h(user_b, email=ADMIN_EMAIL)
    assert client.get("/api/admin/feedback", headers=h).status_code == 200
    assert client.get("/api/admin/contact", headers=h).status_code == 200


def test_overview_lists_accounts_activity_and_inbox(client, monkeypatch, user_a, user_b):
    monkeypatch.setattr(config, "ADMIN_EMAILS", frozenset({ADMIN_EMAIL}))
    client.get("/api/me", headers=_h(user_a))  # creates the profile, as a first visit does
    db = SessionLocal()
    try:
        db.add(PipelineRun(id="run-admin-1", user_id=user_a, tool="trainer", status="succeeded"))
        db.add(PipelineRun(id="run-admin-2", user_id=user_a, tool="backtester", status="failed", error_summary="boom"))
        db.commit()
    finally:
        db.close()
    feedback.submit(str(user_a), ANSWERS)
    contact.submit(name="Ann", email="ann@example.com", message="Hello there, a question about Convolve.", topic="question",
                   website="", elapsed_ms=5000, ip="1.2.3.4", user_id=None)

    body = client.get("/api/admin/overview", headers=_h(user_b, email=ADMIN_EMAIL)).json()
    me = next(u for u in body["users"] if u["id"] == str(user_a))
    assert me["email"] == f"{user_a.hex[:8]}@test.local"
    assert me["runs"] == 2 and me["runs_succeeded"] == 1 and me["runs_failed"] == 1 and me["feedback_done"] is True
    assert body["totals"]["feedback"] == 1 and body["totals"]["contact_messages"] == 1
    assert body["totals"]["ran_experiment"] >= 1 and len(body["signups_daily"]) == 30
    assert {t["tool"] for t in body["tools"]} >= {"trainer", "backtester"}
    failed = next(r for r in body["recent_runs"] if r["id"] == "run-admin-2")
    assert failed["error"] == "boom" and failed["email"] == me["email"]
