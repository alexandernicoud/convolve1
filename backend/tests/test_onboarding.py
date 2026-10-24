from __future__ import annotations

from tests.test_isolation import _auth


def test_new_user_sees_tour_once_and_progress_is_private(client, user_a, user_b):
    ha, hb = _auth(client, user_a), _auth(client, user_b)
    first = client.get("/api/account/onboarding", headers=ha).json()
    assert first["status"] == "new" and first["welcome_seen"] is False and first["step"] == 0
    assert first["steps"][0] == "generate" and first["steps"][-1] == "monitor"

    r = client.put("/api/account/onboarding", json={"status": "active", "step": 2}, headers=ha)
    assert r.status_code == 200 and r.json()["welcome_seen"] is True
    again = client.get("/api/account/onboarding", headers=ha).json()
    assert again["status"] == "active" and again["step"] == 2

    assert client.get("/api/account/onboarding", headers=hb).json()["status"] == "new"
    assert client.get("/api/account/onboarding").status_code == 401


def test_skip_complete_and_restart(client, user_a):
    h = _auth(client, user_a)
    client.put("/api/account/onboarding", json={"status": "dismissed", "step": 1}, headers=h)
    state = client.get("/api/account/onboarding", headers=h).json()
    assert state["status"] == "dismissed" and state["welcome_seen"] is True

    done = client.put("/api/account/onboarding", json={"status": "completed", "step": 5}, headers=h).json()
    assert done["completed_at"]
    restarted = client.put("/api/account/onboarding", json={"status": "active", "step": 0, "welcome_seen": False}, headers=h).json()
    # Restarting never re-arms the automatic welcome overlay.
    assert restarted["welcome_seen"] is True and restarted["completed_at"] == done["completed_at"]


def test_invalid_state_is_refused(client, user_a):
    h = _auth(client, user_a)
    assert client.put("/api/account/onboarding", json={"status": "hacked", "step": 0}, headers=h).status_code == 422
    assert client.put("/api/account/onboarding", json={"status": "active", "step": 9}, headers=h).status_code == 422
    assert client.put("/api/account/onboarding", json={"status": "active", "step": -1}, headers=h).status_code == 422
