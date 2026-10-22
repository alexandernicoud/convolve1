from __future__ import annotations

import uuid

from app.db import SessionLocal
from app.models import PipelineRun


def test_missing_jwt_is_401(client):
    res = client.get("/runs")
    assert res.status_code == 401


def test_auth_401_is_readable_cross_origin(client):
    from app.config import CORS_ORIGINS

    origin = CORS_ORIGINS[0]
    res = client.get("/api/me", headers={"Origin": origin, "Authorization": "Bearer not-a-jwt"})
    assert res.status_code == 401
    assert res.headers.get("access-control-allow-origin") == origin
    other = client.get("/api/me", headers={"Origin": "https://evil.example"})
    assert other.status_code == 401
    assert "access-control-allow-origin" not in other.headers


def test_root_stays_public(client):
    res = client.get("/")
    assert res.status_code == 200


def test_invalid_jwt_is_401(client):
    res = client.get("/runs", headers={"Authorization": "Bearer not-a-jwt"})
    assert res.status_code == 401


def test_expired_jwt_is_401(client, user_a):
    from tests.conftest import mint_token

    token = mint_token(user_a, expired=True)
    res = client.get("/api/me", headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 401


def test_wrong_secret_is_401(client, user_a):
    from tests.conftest import mint_token

    token = mint_token(user_a, secret="other-secret-that-is-not-the-test-key-xx")
    res = client.get("/api/me", headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 401


def test_valid_jwt_me(client, user_a):
    from tests.conftest import mint_token

    token = mint_token(user_a)
    res = client.get("/api/me", headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 200
    assert res.json()["user_id"] == str(user_a)


def test_protected_runs_list_with_valid_jwt(client, user_a):
    from tests.conftest import mint_token

    token = mint_token(user_a)
    res = client.get("/runs", headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 200
    assert res.json()["runs"] == []


def test_ownership_mismatch_is_404(client, user_a, user_b):
    from tests.conftest import mint_token

    token_a = mint_token(user_a)
    token_b = mint_token(user_b)
    client.get("/api/me", headers={"Authorization": f"Bearer {token_a}"})
    client.get("/api/me", headers={"Authorization": f"Bearer {token_b}"})

    run_id = "test_run_ownership_1"
    db = SessionLocal()
    try:
        db.add(
            PipelineRun(
                id=run_id,
                user_id=user_a,
                tool="training-chart-generator",
                status="running",
            )
        )
        db.commit()
    finally:
        db.close()

    denied = client.get(
        f"/api/training-chart-generator/progress/{run_id}",
        headers={"Authorization": f"Bearer {token_b}"},
    )
    assert denied.status_code == 404

    allowed = client.get(
        f"/api/training-chart-generator/progress/{run_id}",
        headers={"Authorization": f"Bearer {token_a}"},
    )
    assert allowed.status_code == 200


def test_jwt_persists_across_requests(client, user_a):
    """The same access token authenticates subsequent requests (stateless session)."""
    from tests.conftest import mint_token

    token = mint_token(user_a)
    headers = {"Authorization": f"Bearer {token}"}
    first = client.get("/api/me", headers=headers)
    second = client.get("/api/me", headers=headers)
    assert first.status_code == 200
    assert second.status_code == 200
    assert first.json()["user_id"] == second.json()["user_id"] == str(user_a)


def test_user_id_in_query_is_ignored(client, user_a, user_b):
    from tests.conftest import mint_token

    token = mint_token(user_a)
    res = client.get(
        f"/api/me?user_id={user_b}",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert res.status_code == 200
    assert res.json()["user_id"] == str(user_a)
