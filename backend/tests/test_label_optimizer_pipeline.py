"""Headless Labeling Optimizer run (methodology v2): research/evaluation split and artifacts."""

from __future__ import annotations

import json

import pytest

from app.services import label_grid
from scripts.perf.bench_label_optimizer import load_engine, synthetic_ohlc

pytestmark = pytest.mark.skipif(not label_grid.HAVE_NUMBA, reason="compiled label kernels unavailable")


@pytest.fixture(scope="module")
def opt():
    return load_engine()


def _run(opt, tmp_path, df, cfg=None):
    tmp_path.mkdir(parents=True, exist_ok=True)
    if cfg is not None:
        (tmp_path / "optimizer_config.json").write_text(json.dumps(cfg))
    opt.run_headless("SYN", str(df.index[0].date()), str(df.index[-1].date()), str(tmp_path), df=df)
    art = tmp_path / "artifacts"
    return art, {p.name for p in art.iterdir()}


def _load(art, name):
    return json.loads((art / f"{name}.json").read_text())


def test_research_end_splits_periods_and_ranking_ignores_evaluation(opt, tmp_path):
    df = synthetic_ohlc(260)
    sel = str(df.index[199].date())
    art, names = _run(opt, tmp_path / "a", df, {"selection_end": sel})
    assert {"research_surface.json", "research_candidates.json", "optimizer_run.json", "optimizer_surface.json"} <= names
    assert not any(n.endswith((".png", ".html", ".csv")) for n in names)

    run = _load(art, "optimizer_run")
    assert run["methodology_version"] == 2
    periods = run["periods"]
    assert periods["research"] == {"start": "2015-01-02", "end": sel, "bars": 200}
    assert periods["evaluation"]["start"] == str(df.index[200].date())
    assert periods["evaluation"]["bars"] == 60
    cands = _load(art, "research_candidates")
    assert cands["profitability_model"] == "mark_to_market"
    assert all(c["evaluation"] is not None for c in cands["candidates"])

    # Changing only the evaluation bars leaves every research figure and ranking unchanged.
    shocked = df.copy()
    shocked.iloc[200:] *= 0.7
    art2, _ = _run(opt, tmp_path / "b", shocked, {"selection_end": sel})
    c2 = _load(art2, "research_candidates")
    assert c2["best"] == cands["best"]
    strip = lambda cs: [{k: c[k] for k in ("tp", "sl", "h", "ranks", "scores", "research")} for c in cs]
    assert strip(c2["candidates"]) == strip(cands["candidates"])
    assert _load(art2, "optimizer_surface") == _load(art, "optimizer_surface")


def test_without_research_end_whole_range_is_research(opt, tmp_path):
    df = synthetic_ohlc(150)
    art, _ = _run(opt, tmp_path, df)
    periods = _load(art, "optimizer_run")["periods"]
    assert periods["evaluation"] is None
    assert periods["research"]["bars"] == 150
    assert _load(art, "research_candidates")["candidates"][0]["evaluation"] is None
