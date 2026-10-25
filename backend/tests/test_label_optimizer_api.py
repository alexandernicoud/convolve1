"""Request validation for the optimizer research period and Generator provenance."""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from app.main import RunRequest, TrainingChartGeneratorRequest, sanitize_optimizer_source

_GEN = dict(
    symbols="AAPL", chartsPerLabel=50, useCandles=True, timeframe="1d", timespanUnit="months",
    timespanCount=6, horizonBars=7, takeProfitFraction=0.02, stopLossFraction=0.01,
    imageDimension=224, endOffset=0,
)


def test_selection_end_optional_and_normalised():
    assert RunRequest(symbol="AAPL", start="2015-01-01", end="2024-01-01").selection_end is None
    assert RunRequest(symbol="AAPL", start="2015-01-01", end="2024-01-01", selection_end="").selection_end is None
    req = RunRequest(symbol="AAPL", start="2015-01-01", end="2024-01-01", selection_end="2022-06-30")
    assert req.selection_end == "2022-06-30"
    assert req.model_dump()["selection_end"] == "2022-06-30"


@pytest.mark.parametrize("sel", ["2014-12-31", "2015-01-01", "2024-01-01", "2025-01-01", "2015-06-01", "2023-12-15", "June 2022"])
def test_selection_end_rejected_outside_bounds(sel):
    with pytest.raises(ValidationError):
        RunRequest(symbol="AAPL", start="2015-01-01", end="2024-01-01", selection_end=sel)


def test_optimizer_source_whitelist_and_ranges():
    clean = sanitize_optimizer_source({
        "run_id": "20261025_120000_abc123", "mode": "suitability", "symbol": "aapl",
        "tp": 0.03, "sl": 0.015, "h": 12, "methodology_version": 2,
        "research_start": "2015-01-02", "research_end": "2022-06-30T00:00:00",
        "path": "/etc/passwd", "extra": {"x": 1},
    })
    assert clean == {
        "run_id": "20261025_120000_abc123", "mode": "suitability", "symbol": "AAPL",
        "tp": 0.03, "sl": 0.015, "h": 12, "methodology_version": 2,
        "research_start": "2015-01-02", "research_end": "2022-06-30",
    }
    assert sanitize_optimizer_source(None) is None
    assert sanitize_optimizer_source({"unknown": 1}) is None
    for bad in ({"run_id": "../x"}, {"mode": "best"}, {"tp": 1.5}, {"sl": 0}, {"tp": True},
                {"h": 0}, {"h": 2.5}, {"research_end": "soon"}, {"symbol": "A B"}):
        with pytest.raises(ValueError):
            sanitize_optimizer_source(bad)


def test_generator_request_carries_clean_provenance():
    req = TrainingChartGeneratorRequest(**_GEN, sourceOptimizer={"run_id": "r1", "tp": 0.02, "junk": 1})
    assert req.model_dump()["sourceOptimizer"] == {"run_id": "r1", "tp": 0.02}
    assert TrainingChartGeneratorRequest(**_GEN).sourceOptimizer is None
    with pytest.raises(ValidationError):
        TrainingChartGeneratorRequest(**_GEN, sourceOptimizer={"mode": "nope"})
