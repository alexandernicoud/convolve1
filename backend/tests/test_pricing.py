from __future__ import annotations

import uuid

import pytest
from fastapi import HTTPException

from app import config, pricing
from app.main import register_run
from app.services import credits
from tests.test_credits import _balance, _ledger
from tests.test_isolation import _auth


@pytest.fixture
def enforce(monkeypatch):
    monkeypatch.setattr(config, "CREDITS_MODE", "enforce")


class _Req:
    def __init__(self, **headers: str):
        self.headers = {k.lower(): v for k, v in headers.items()}


def test_generator_price_grows_with_charts_assets_and_image_size():
    small = pricing.quote("training-chart-generator", {"symbols": "AAPL", "charts_per_label": 10})
    big = pricing.quote("training-chart-generator", {"symbols": "AAPL", "charts_per_label": 1000})
    multi = pricing.quote("training-chart-generator", {"symbols": "AAPL, MSFT", "charts_per_label": 1000})
    hires = pricing.quote("training-chart-generator", {"symbols": "AAPL", "charts_per_label": 1000, "image_dimension": 448})
    assert small.credits == 2 and small.kind == "fixed"
    assert big.credits == 6  # 2,000 charts
    assert small.credits < big.credits < multi.credits < hires.credits
    assert pricing.symbol_count("aapl AAPL;msft") == 2


def test_trainer_price_uses_dataset_epochs_and_image_size():
    std = pricing.quote("trainer", {"dataset_images": 2000})
    assert std.credits == 14 and std.kind == "fixed"  # 1,600 x 30 epochs at 224 px
    assert pricing.quote("trainer", {}).kind == "estimated"
    custom = pricing.quote(
        "trainer",
        {"use_standard_config": False, "dataset_images": 2000, "epochs": 10, "image_height": 224, "image_width": 224, "val_split": 0.2},
    )
    assert custom.credits < std.credits
    large = pricing.quote(
        "trainer",
        {"use_standard_config": False, "dataset_images": 2000, "epochs": 30, "image_height": 448, "image_width": 448, "val_split": 0.2},
    )
    assert large.credits > std.credits


def test_bounds_clamp_absurd_configurations():
    q = pricing.quote("training-chart-generator", {"symbols": "A B C D E F G H", "charts_per_label": 100000})
    assert q.credits == pricing.BOUNDS["training-chart-generator"][1] and q.clamped
    assert pricing.quote("trainer", {"dataset_images": 1}).credits >= pricing.BOUNDS["trainer"][0]


def test_other_tools_and_unknown_tools():
    assert pricing.quote("analysis").credits == 2
    assert pricing.quote("backtester", {"dataset_images": 500}).credits == 2
    assert pricing.quote("backtester", {"dataset_images": 5000, "sample_size": 100}).credits == 2
    assert pricing.quote("backtester", {"dataset_images": 500, "engine": "v2"}).credits == 3
    assert pricing.quote("testdata", {"symbols": "TSLA", "period_length_units": 252}).credits == 13
    assert pricing.quote("labeling-optimizer", {"start": "2020-01-01", "end": "2025-01-01"}).credits == 21
    assert pricing.quote("labeling-optimizer", {"start": "2024-01-01", "end": "2025-01-01"}).credits == 5
    assert pricing.quote("bot").credits == 0


def test_default_workflow_fits_the_free_allocation():
    workflow = (
        pricing.quote("training-chart-generator", {"symbols": "AAPL", "charts_per_label": 1000}).credits
        + pricing.quote("trainer", {"dataset_images": 2000}).credits
        + pricing.quote("analysis").credits
        + pricing.quote("backtester", {"dataset_images": 500}).credits
    )
    assert workflow <= 25


def test_quote_endpoint_prices_configuration_and_flags_confirmation(client, user_a):
    h = _auth(client, user_a)
    r = client.post(
        "/api/credits/quote",
        json={"tool": "training-chart-generator", "params": {"symbols": "AAPL", "charts_per_label": 1000}},
        headers=h,
    )
    body = r.json()
    assert r.status_code == 200 and body["cost"] == 6 and body["mode"] != "enforce"
    assert body["pricing"]["version"] == pricing.PRICING_VERSION and body["pricing"]["lines"]
    big = client.post(
        "/api/credits/quote", json={"tool": "trainer", "params": {"dataset_images": 20000}}, headers=h,
    ).json()
    assert big["confirm"] is True
    catalogue = client.get("/api/plans").json()
    assert catalogue["pricing_version"] == pricing.PRICING_VERSION
    assert all("formula" in c and c["min"] <= c["credits"] <= c["max"] for c in catalogue["run_costs"])


def test_server_price_is_charged_and_recorded(enforce, client, user_a):
    _auth(client, user_a)
    q = pricing.quote("training-chart-generator", {"symbols": "AAPL", "charts_per_label": 1000})
    run_id = f"pr_{uuid.uuid4().hex[:10]}"
    register_run(run_id, "training-chart-generator", "/x", user_id=str(user_a), price=q)
    assert _balance(user_a) == 50 - q.credits
    assert _ledger(user_a)[-1] == ("charge", -q.credits)


def test_higher_price_than_shown_is_refused(enforce, client, user_a):
    _auth(client, user_a)
    q = pricing.quote("trainer", {"dataset_images": 2000})
    with pytest.raises(HTTPException) as exc:
        register_run(
            f"pr_{uuid.uuid4().hex[:10]}", "trainer", "/x", user_id=str(user_a), price=q,
            http_request=_Req(**{"X-Expected-Credits": str(q.credits - 1)}),
        )
    assert exc.value.status_code == 409 and exc.value.detail["code"] == "price_changed"
    assert _balance(user_a) == 50


def test_duplicate_submission_is_charged_once_and_refund_still_works(enforce, client, user_a):
    _auth(client, user_a)
    q = pricing.quote("analysis")
    req = _Req(**{"Idempotency-Key": "form-123"})
    first = f"pr_{uuid.uuid4().hex[:10]}"
    register_run(first, "analysis", "/x", user_id=str(user_a), price=q, http_request=req)
    with pytest.raises(HTTPException) as exc:
        register_run(f"pr_{uuid.uuid4().hex[:10]}", "analysis", "/x", user_id=str(user_a), price=q, http_request=req)
    assert exc.value.status_code == 409 and exc.value.detail == {
        "code": "duplicate_submission",
        "message": exc.value.detail["message"],
        "run_id": first,
    }
    assert _balance(user_a) == 50 - q.credits
    assert credits.refund_run(first, "Run failed") is True
    assert _balance(user_a) == 50


def test_off_mode_quotes_but_never_charges(monkeypatch, client, user_a):
    monkeypatch.setattr(config, "CREDITS_MODE", "off")
    _auth(client, user_a)
    q = pricing.quote("trainer", {"dataset_images": 2000})
    register_run(f"pr_{uuid.uuid4().hex[:10]}", "trainer", "/x", user_id=str(user_a), price=q)
    assert _ledger(user_a) == []
