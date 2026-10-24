"""Credit pricing policy: how many credits one run costs, computed from its configuration.

This module is the only place run prices are defined. The server computes the price
from the submitted configuration (and, where needed, from data it holds such as the
number of images in a dataset) when the run is accepted; clients never send a price.

Policy ``PRICING_VERSION``
--------------------------
* Prices are fixed upfront: the same configuration always costs the same, and a run is
  never metered or re-priced after it starts. Early stopping, cache hits or a fast
  machine do not lower the price; a slow machine does not raise it.
* Each tool has a base charge (setup: data download, model load, container start) plus a
  work term proportional to the computation the configuration implies, rounded up, then
  clamped to the tool's bounds.
* Calibration (local benchmark, Apple silicon CPU, October 2026 run history):
    - dataset generator  ~0.05-0.07 s per chart at 224 px
    - CNN training       ~0.03-0.06 s per training image per epoch at 224 px
    - labeling optimizer 25x25x200 grid over 1,258 daily bars: ~1,070 s
    - test-data charts   ~2.4 s per chart (render + label)
    - analysis           3-7 s for one sample image
  One credit corresponds to roughly 30-60 s of that reference compute. The constants
  below are rounded so that the default end-to-end workflow (generate, train, analyse,
  backtest) costs about 20-25 credits, inside the free starter allocation.
* Bounds keep a mistyped configuration from producing an absurd price; a configuration
  above a tool's maximum is still charged the maximum.

Changing any constant here changes prices: bump ``PRICING_VERSION`` and record why.
"""

from __future__ import annotations

import math
import re
from dataclasses import asdict, dataclass, field
from datetime import date
from typing import Any, Dict, List, Mapping, Optional, Tuple

PRICING_VERSION = "2026-10-24.1"

# A run at or above this price asks for explicit confirmation in the UI.
CONFIRM_ABOVE = 25

BOUNDS: Dict[str, Tuple[int, int]] = {
    "training-chart-generator": (1, 150),
    "trainer": (2, 300),
    "analysis": (2, 2),
    "backtester": (1, 40),
    "testdata": (2, 120),
    "labeling-optimizer": (1, 150),
}

TOOL_LABELS: Dict[str, str] = {
    "training-chart-generator": "Dataset generator",
    "trainer": "CNN training",
    "analysis": "Model analysis",
    "backtester": "Backtest",
    "testdata": "Test data",
    "labeling-optimizer": "Labeling optimizer",
}

# Work units per credit, per tool (see calibration above).
GENERATOR_IMAGES_PER_CREDIT = 400
TRAINER_IMAGE_EPOCHS_PER_CREDIT = 4000
BACKTEST_PREDICTIONS_PER_CREDIT = 1000
TESTDATA_CHARTS_PER_CREDIT = 25
OPTIMIZER_EVALUATIONS_PER_CREDIT = 8_000_000

# The optimizer script searches a fixed grid; only the history length is configurable.
OPTIMIZER_GRID = 25 * 25 * 200

TRAINER_STANDARD = {"image_height": 224, "image_width": 224, "epochs": 30, "val_split": 0.2}
BARS_PER_DAY = {"1d": 252 / 365, "1wk": 1 / 7, "1mo": 1 / 30.4}
REFERENCE_PIXELS = 224 * 224


@dataclass
class Quote:
    tool: str
    credits: int
    # "fixed": every input is known, this is exactly what the run will cost.
    # "estimated": an input was missing (e.g. dataset size) and a default was assumed;
    #              the server prices the real value when the run is submitted.
    kind: str
    version: str = PRICING_VERSION
    label: str = ""
    formula: str = ""
    lines: List[Dict[str, Any]] = field(default_factory=list)
    inputs: Dict[str, Any] = field(default_factory=dict)
    bounds: Tuple[int, int] = (0, 0)
    clamped: bool = False

    def as_dict(self) -> Dict[str, Any]:
        out = asdict(self)
        out["bounds"] = list(self.bounds)
        out["confirm"] = self.credits >= CONFIRM_ABOVE
        return out

    def record(self) -> Dict[str, Any]:
        """Compact form stored with the run and on its ledger row."""
        return {"version": self.version, "credits": self.credits, "kind": self.kind, "inputs": self.inputs}

    def note(self) -> str:
        return f"pricing {self.version}: " + ", ".join(f"{l['label']} {l['value']}" for l in self.lines)


def _int(value: Any, default: int) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _float(value: Any, default: float) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _date(value: Any) -> Optional[date]:
    try:
        return date.fromisoformat(str(value)[:10])
    except (TypeError, ValueError):
        return None


def _pixels(height: int, width: int) -> float:
    return max(0.25, (max(height, 1) * max(width, 1)) / REFERENCE_PIXELS)


def symbol_count(symbols: Any) -> int:
    if isinstance(symbols, (list, tuple)):
        tokens = [str(s) for s in symbols]
    else:
        tokens = re.split(r"[\s,;]+", str(symbols or ""))
    return max(1, len({t.strip().upper() for t in tokens if t.strip()}))


def _finish(tool: str, base: int, work: float, per_credit: float, formula: str, lines, inputs, kind="fixed") -> Quote:
    lo, hi = BOUNDS[tool]
    raw = base + (math.ceil(work / per_credit) if per_credit else 0)
    credits = min(hi, max(lo, raw))
    return Quote(
        tool=tool, credits=credits, kind=kind, label=TOOL_LABELS[tool], formula=formula,
        lines=lines, inputs=inputs, bounds=(lo, hi), clamped=credits != raw,
    )


def _generator(p: Mapping[str, Any]) -> Quote:
    n_symbols = symbol_count(p.get("symbols"))
    per_label = max(1, _int(p.get("charts_per_label"), 100))
    dim = max(32, _int(p.get("image_dimension"), 224))
    images = 2 * per_label * n_symbols
    pixels = _pixels(dim, dim)
    return _finish(
        "training-chart-generator", 1, images * pixels, GENERATOR_IMAGES_PER_CREDIT,
        f"1 + ceil(charts x image-size factor / {GENERATOR_IMAGES_PER_CREDIT})",
        [
            {"label": "Assets", "value": n_symbols},
            {"label": "Charts (up to)", "value": images},
            {"label": "Image size", "value": f"{dim} px"},
        ],
        {"symbols": n_symbols, "charts_per_label": per_label, "image_dimension": dim},
    )


def _trainer(p: Mapping[str, Any]) -> Quote:
    standard = bool(p.get("use_standard_config", True))
    src = TRAINER_STANDARD if standard else p
    height = max(32, _int(src.get("image_height"), 224))
    width = max(32, _int(src.get("image_width"), 224))
    epochs = max(1, _int(src.get("epochs"), 30))
    val_split = min(0.9, max(0.0, _float(src.get("val_split"), 0.2)))
    images = p.get("dataset_images")
    kind = "fixed" if images is not None else "estimated"
    images = max(1, _int(images, 1000))
    train_images = max(1, round(images * (1 - val_split)))
    work = train_images * epochs * _pixels(height, width)
    return _finish(
        "trainer", 2, work, TRAINER_IMAGE_EPOCHS_PER_CREDIT,
        f"2 + ceil(training images x epochs x image-size factor / {TRAINER_IMAGE_EPOCHS_PER_CREDIT})",
        [
            {"label": "Training images", "value": train_images},
            {"label": "Epochs (max)", "value": epochs},
            {"label": "Image size", "value": f"{height}x{width}"},
        ],
        {"dataset_images": images, "epochs": epochs, "image_height": height, "image_width": width, "val_split": val_split},
        kind,
    )


def _analysis(_p: Mapping[str, Any]) -> Quote:
    return _finish(
        "analysis", 2, 0, 0, "Fixed: one sample image, all analysis methods",
        [{"label": "Images analysed", "value": 1}], {},
    )


def _backtester(p: Mapping[str, Any]) -> Quote:
    images = p.get("dataset_images")
    kind = "fixed" if images is not None else "estimated"
    images = max(1, _int(images, 500))
    sample = p.get("sample_size", "all")
    predictions = images if str(sample).lower() in ("all", "", "none") else min(images, max(1, _int(sample, images)))
    v2 = str(p.get("engine") or "").lower() == "v2"
    return _finish(
        "backtester", 2 if v2 else 1, predictions, BACKTEST_PREDICTIONS_PER_CREDIT,
        f"{'2 (price simulation)' if v2 else '1'} + ceil(predictions / {BACKTEST_PREDICTIONS_PER_CREDIT})",
        [{"label": "Predictions", "value": predictions}, {"label": "Engine", "value": "v2" if v2 else "v1"}],
        {"dataset_images": images, "predictions": predictions, "engine": "v2" if v2 else "v1"},
        kind,
    )


def _testdata(p: Mapping[str, Any]) -> Quote:
    # One chart per bar in the test window, per symbol (the generator's --x argument).
    bars = max(1, _int(p.get("period_length_units"), 30))
    n_symbols = symbol_count(p.get("symbols"))
    charts = bars * n_symbols
    dim = max(32, _int(p.get("img_dim"), 224))
    return _finish(
        "testdata", 2, charts * _pixels(dim, dim), TESTDATA_CHARTS_PER_CREDIT,
        f"2 + ceil(charts x image-size factor / {TESTDATA_CHARTS_PER_CREDIT})",
        [
            {"label": "Bars in test window", "value": bars},
            {"label": "Assets", "value": n_symbols},
            {"label": "Charts (up to)", "value": charts},
            {"label": "Image size", "value": f"{dim} px"},
        ],
        {"bars": bars, "symbols": n_symbols, "charts": charts, "img_dim": dim},
    )


def _optimizer(p: Mapping[str, Any]) -> Quote:
    start, end = _date(p.get("start")), _date(p.get("end"))
    days = (end - start).days if start and end and end > start else 5 * 365
    bars = max(1, math.ceil(days * BARS_PER_DAY["1d"]))
    return _finish(
        "labeling-optimizer", 1, OPTIMIZER_GRID * bars, OPTIMIZER_EVALUATIONS_PER_CREDIT,
        f"1 + ceil({OPTIMIZER_GRID:,} label rules x bars / {OPTIMIZER_EVALUATIONS_PER_CREDIT:,})",
        [
            {"label": "History", "value": f"{bars} daily bars"},
            {"label": "Label rules tested", "value": f"{OPTIMIZER_GRID:,}"},
        ],
        {"bars": bars, "grid": OPTIMIZER_GRID},
    )


_PRICERS = {
    "training-chart-generator": _generator,
    "trainer": _trainer,
    "analysis": _analysis,
    "backtester": _backtester,
    "testdata": _testdata,
    "labeling-optimizer": _optimizer,
}


def priced(tool: str) -> bool:
    return tool in _PRICERS


def quote(tool: str, params: Optional[Mapping[str, Any]] = None) -> Quote:
    """Price one run of ``tool``. Tools without a pricer (paper bots, uploads) cost 0."""
    pricer = _PRICERS.get(tool)
    if pricer is None:
        return Quote(tool=tool, credits=0, kind="fixed", label=tool, formula="No credit charge")
    return pricer(params or {})


def default_cost(tool: str) -> int:
    return quote(tool).credits


def catalogue() -> List[Dict[str, Any]]:
    """Public price list: formula, bounds and the price of the default configuration."""
    out = []
    for tool in _PRICERS:
        q = quote(tool)
        out.append({
            "tool": tool, "label": TOOL_LABELS[tool], "credits": q.credits, "min": q.bounds[0], "max": q.bounds[1],
            "formula": q.formula,
        })
    return out
