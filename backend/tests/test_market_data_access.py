"""Market-data cohort: tools that download prices are limited to invited accounts when restricted."""

from __future__ import annotations

import pytest

from app import config as app_config
from app.db import SessionLocal
from app.models import PipelineRun
from tests.test_research_jobs import GEN, _h, research  # noqa: F401


@pytest.fixture
def cohort(monkeypatch, user_b):
    monkeypatch.setattr(app_config, "MARKET_DATA_ACCESS", "cohort")
    monkeypatch.setattr(app_config, "MARKET_DATA_COHORT", frozenset({str(user_b).lower()}))


def _code(r):
    detail = r.json().get("detail")
    return detail.get("code") if isinstance(detail, dict) else None


def test_outside_the_cohort_every_price_download_is_refused(client, user_a, research, cohort):
    calls = [
        ("post", "/api/training-chart-generator/run", GEN),
        ("post", "/api/training-chart-generator/estimate", {**GEN, "chartsPerLabel": 20}),
        ("post", "/api/training-chart-generator/preview", GEN),
        ("get", "/api/yfinance/search?q=AAPL", None),
        ("post", "/api/labeling-optimizer/run", {"symbol": "MSFT", "start": "2020-01-01", "end": "2024-06-01"}),
        ("post", "/runs/testdata/start", {"symbols": "AAPL", "dataset_name": "t1", "period_length_units": 5, "img_dim": 64}),
    ]
    for method, path, body in calls:
        r = getattr(client, method)(path, json=body, headers=_h(user_a)) if body else client.get(path, headers=_h(user_a))
        assert r.status_code == 403 and _code(r) == "market_data_restricted", (path, r.status_code, r.text)
    db = SessionLocal()
    try:
        assert db.query(PipelineRun).filter(PipelineRun.user_id == user_a).count() == 0
    finally:
        db.close()
    assert client.get("/api/me", headers=_h(user_a)).json()["market_data_access"] is False
    assert client.get("/api/plans").json()["market_data"]["access"] == "cohort"


def test_cohort_members_pass_the_gate(client, user_b, research, cohort):
    r = client.post("/api/training-chart-generator/run", json=GEN, headers=_h(user_b))
    assert r.status_code == 200, r.text
    assert client.get("/api/me", headers=_h(user_b)).json()["market_data_access"] is True


def test_open_access_is_the_default(client, user_a, research):
    assert app_config.MARKET_DATA_ACCESS == "open"
    r = client.post("/api/training-chart-generator/run", json=GEN, headers=_h(user_a))
    assert r.status_code == 200, r.text
    assert client.get("/api/me", headers=_h(user_a)).json()["market_data_access"] is True


def test_scheduled_bots_of_accounts_outside_the_cohort_are_skipped(monkeypatch, user_a):
    from app.services import market_data_access

    monkeypatch.setattr(app_config, "MARKET_DATA_ACCESS", "cohort")
    monkeypatch.setattr(app_config, "MARKET_DATA_COHORT", frozenset())
    assert market_data_access.allowed(str(user_a)) is False
    assert market_data_access.allowed(None) is False
