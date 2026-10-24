"""Every registered route refuses requests without a valid user token, except the public list."""

from __future__ import annotations

import re
from datetime import datetime, timedelta, timezone

import jwt
import pytest
from fastapi.routing import APIRoute

from app.auth import PUBLIC_PATHS
from app.main import app
from tests.conftest import AUDIENCE, JWT_SECRET

PUBLIC = set(PUBLIC_PATHS)


def _concrete(path: str) -> str:
    return re.sub(r"\{[^}]+\}", "x1", path)


def _routes():
    for route in app.routes:
        if not isinstance(route, APIRoute) or route.path in PUBLIC:
            continue
        for method in sorted(route.methods - {"HEAD", "OPTIONS"}):
            yield method, _concrete(route.path)


def _token(**claims) -> str:
    now = datetime.now(timezone.utc)
    payload = {"aud": AUDIENCE, "iat": int(now.timestamp()), "exp": int((now + timedelta(hours=1)).timestamp())}
    payload.update(claims)
    return jwt.encode(payload, JWT_SECRET, algorithm="HS256")


BAD_TOKENS = {
    "none": None,
    # The browser's anon key: valid signature, but no user subject.
    "anon_key": _token(role="anon"),
    "wrong_audience": _token(sub="5f4c2f0e-8b1d-4a5e-9b7a-1c2d3e4f5a6b", aud="someone-else"),
    "unsigned": jwt.encode({"sub": "5f4c2f0e-8b1d-4a5e-9b7a-1c2d3e4f5a6b", "aud": AUDIENCE, "exp": 9999999999}, None, algorithm="none"),
}


def test_inventory_is_not_empty():
    assert len(list(_routes())) > 50


@pytest.mark.parametrize("kind", sorted(BAD_TOKENS))
def test_every_private_route_rejects_bad_tokens(client, kind):
    token = BAD_TOKENS[kind]
    headers = {"Authorization": f"Bearer {token}"} if token else {}
    leaks = []
    for method, path in _routes():
        r = client.request(method, path, headers=headers)
        if r.status_code != 401:
            leaks.append(f"{method} {path} -> {r.status_code}")
    assert leaks == []


def test_public_routes_stay_public(client):
    assert client.get("/").status_code == 200
    assert client.get("/api/plans").status_code == 200
