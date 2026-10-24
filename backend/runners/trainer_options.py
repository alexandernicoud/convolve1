"""The Trainer's supported training options: one schema, validated once, used by the API, the
runner, the checkpoint fingerprint and the run manifest.

Protocol versions
    1  Runs started before Trainer 2.0. Their recorded configuration has no ``trainer_protocol``
       key and keeps its original meaning: random split in directory order, Adam with Keras
       defaults, val_loss early stopping (patience 5), no global seeding of weights.
    2  New runs. Chronological split with purging, sorted sample manifest, every supported
       random operation seeded, op determinism, richer metrics. Every option below.

Unknown keys and out-of-range values are rejected rather than ignored. No TensorFlow import.
"""

from __future__ import annotations

import copy
from typing import Any, Dict, List, Optional

PROTOCOL = 2

OPTIMIZERS = {
    "adam": {"learning_rate": 1e-3, "clipnorm": None},
    "adamw": {"learning_rate": 1e-3, "weight_decay": 1e-4, "clipnorm": None},
    "sgd": {"learning_rate": 1e-2, "momentum": 0.9, "nesterov": True, "clipnorm": None},
}
SCHEDULES = {
    "constant": {},
    # Per epoch: halves the learning rate after `patience` epochs without improvement of the
    # selection metric.
    "reduce_on_plateau": {"factor": 0.5, "patience": 2, "min_learning_rate": 1e-6},
    # Per optimizer step: cosine from the base rate to alpha x base over all planned steps.
    "cosine": {"alpha": 0.0},
    # Per optimizer step: linear warmup from 0 over `warmup_epochs`, then cosine decay.
    "warmup_cosine": {"warmup_epochs": 1, "alpha": 0.0},
}
SELECTION_METRICS = {
    "val_loss": "min",
    "val_balanced_accuracy": "max",
    "val_auc": "max",
    "val_pr_auc": "max",
    "val_accuracy": "max",
}
CLASS_WEIGHTING = ("none", "balanced")
TRANSFER_MODES = ("scratch", "frozen", "fine_tune")

# Each candidate augmentation with the reason it is or is not offered. Only "allowed" ones can
# be selected; all are off by default.
AUGMENTATIONS: Dict[str, Dict[str, Any]] = {
    "pixel_noise": {
        "allowed": True,
        "label": "Pixel noise",
        "detail": "Adds faint Gaussian noise (sigma 0.02 of the 0-1 range) to training images. Candle positions, "
        "time order and price direction are unchanged, so the label keeps its meaning. A mild regularizer.",
    },
    "vertical_shift": {
        "allowed": True,
        "label": "Small vertical shift",
        "detail": "Moves the whole chart up or down by up to 3% of its height (edges filled with the background). "
        "Relative price moves and time order are unchanged; only the absolute position, which the renderer's "
        "auto-scaling makes arbitrary anyway, moves.",
    },
    "horizontal_flip": {
        "allowed": False,
        "label": "Horizontal flip",
        "detail": "Reverses time: the most recent candles would appear on the left. The label refers to what "
        "happens after the right edge, so a flipped chart no longer matches its label.",
    },
    "vertical_flip": {
        "allowed": False,
        "label": "Vertical flip",
        "detail": "Turns rises into falls. A chart labelled 'take profit hit first' would show the opposite move.",
    },
    "rotation": {
        "allowed": False,
        "label": "Rotation",
        "detail": "Changes the slope of every trend and mixes time with price.",
    },
    "horizontal_crop_or_shift": {
        "allowed": False,
        "label": "Horizontal crop or shift",
        "detail": "Cuts off the most recent candles (the decision bar) or adds bars that are not in the window.",
    },
    "color_jitter": {
        "allowed": False,
        "label": "Colour jitter",
        "detail": "Up and down candles are distinguished by colour; changing colours can swap their meaning. "
        "The renderer always uses the same colours, so there is nothing to be robust against.",
    },
}

DEFAULT_PATIENCE = 5


class OptionsError(ValueError):
    pass


def _num(value: Any, name: str, lo: float, hi: float, *, integer: bool = False) -> Any:
    if isinstance(value, bool) or value is None:
        raise OptionsError(f"{name} must be a number")
    try:
        out = int(value) if integer else float(value)
    except (TypeError, ValueError) as exc:
        raise OptionsError(f"{name} must be a number") from exc
    if integer and float(value) != out:
        raise OptionsError(f"{name} must be a whole number")
    if not lo <= out <= hi:
        raise OptionsError(f"{name} must be between {lo:g} and {hi:g}")
    return out


def _only(d: Dict[str, Any], allowed: List[str], where: str) -> None:
    extra = sorted(set(d) - set(allowed))
    if extra:
        raise OptionsError(f"Unknown {where} setting(s): {', '.join(extra)}")


def protocol_of(config: Dict[str, Any]) -> int:
    try:
        return int(config.get("trainer_protocol") or 1)
    except (TypeError, ValueError):
        return 1


def resolve(config: Dict[str, Any]) -> Dict[str, Any]:
    """Validated, fully explicit options for a run configuration (raises OptionsError)."""
    protocol = protocol_of(config)
    if protocol not in (1, 2):
        raise OptionsError(f"Unknown trainer protocol {protocol}")
    legacy = protocol == 1

    opt_in = dict(config.get("optimizer") or {"name": "adam"})
    name = str(opt_in.pop("name", "adam"))
    if name not in OPTIMIZERS:
        raise OptionsError(f"optimizer must be one of {', '.join(OPTIMIZERS)}")
    _only(opt_in, list(OPTIMIZERS[name]), f"{name} optimizer")
    optimizer = {"name": name, **copy.deepcopy(OPTIMIZERS[name])}
    for key, value in opt_in.items():
        if value is None:
            continue
        if key == "learning_rate":
            optimizer[key] = _num(value, "Learning rate", 1e-6, 1.0)
        elif key == "weight_decay":
            optimizer[key] = _num(value, "Weight decay", 0.0, 0.5)
        elif key == "momentum":
            optimizer[key] = _num(value, "Momentum", 0.0, 0.999)
        elif key == "nesterov":
            optimizer[key] = bool(value)
        elif key == "clipnorm":
            optimizer[key] = _num(value, "Gradient clipping norm", 1e-3, 100.0)

    sched_in = dict(config.get("lr_schedule") or {"name": "constant"})
    sname = str(sched_in.pop("name", "constant"))
    if sname not in SCHEDULES:
        raise OptionsError(f"lr_schedule must be one of {', '.join(SCHEDULES)}")
    _only(sched_in, list(SCHEDULES[sname]), f"{sname} schedule")
    schedule = {"name": sname, **copy.deepcopy(SCHEDULES[sname])}
    for key, value in sched_in.items():
        if value is None:
            continue
        if key == "factor":
            schedule[key] = _num(value, "Reduction factor", 0.05, 0.95)
        elif key == "patience":
            schedule[key] = _num(value, "Plateau patience", 1, 50, integer=True)
        elif key == "min_learning_rate":
            schedule[key] = _num(value, "Minimum learning rate", 0.0, 1.0)
        elif key == "alpha":
            schedule[key] = _num(value, "Final learning-rate fraction", 0.0, 1.0)
        elif key == "warmup_epochs":
            schedule[key] = _num(value, "Warmup epochs", 1, 50, integer=True)

    reg_in = dict(config.get("regularization") or {})
    _only(reg_in, ["dropout", "l2"], "regularization")
    regularization = {
        "dropout": None if reg_in.get("dropout") is None else _num(reg_in["dropout"], "Dropout", 0.0, 0.8),
        "l2": 0.0 if reg_in.get("l2") is None else _num(reg_in["l2"], "L2 penalty", 0.0, 0.1),
    }
    if optimizer["name"] == "adamw" and optimizer.get("weight_decay") and regularization["l2"]:
        raise OptionsError(
            "AdamW weight decay and an L2 penalty both shrink the weights; use one of them (set the L2 penalty to 0 "
            "or switch to Adam)."
        )

    es_in = dict(config.get("early_stopping") or {})
    _only(es_in, ["patience", "min_delta", "enabled"], "early stopping")
    early_stopping = {
        "enabled": bool(es_in.get("enabled", True)),
        "patience": DEFAULT_PATIENCE if es_in.get("patience") is None else _num(es_in["patience"], "Patience", 1, 100, integer=True),
        "min_delta": 0.0 if es_in.get("min_delta") is None else _num(es_in["min_delta"], "Minimum improvement", 0.0, 1.0),
    }

    selection = str(config.get("selection_metric") or "val_loss")
    if selection not in SELECTION_METRICS:
        raise OptionsError(f"selection_metric must be one of {', '.join(SELECTION_METRICS)}")

    weighting = str(config.get("class_weighting") or "none")
    if weighting not in CLASS_WEIGHTING:
        raise OptionsError(f"class_weighting must be one of {', '.join(CLASS_WEIGHTING)}")

    aug = config.get("augmentation") or []
    if not isinstance(aug, list):
        raise OptionsError("augmentation must be a list")
    for a in aug:
        if a not in AUGMENTATIONS:
            raise OptionsError(f"Unknown augmentation '{a}'")
        if not AUGMENTATIONS[a]["allowed"]:
            raise OptionsError(f"{AUGMENTATIONS[a]['label']} is not offered: {AUGMENTATIONS[a]['detail']}")
    augmentation = sorted(set(aug))

    tr_in = dict(config.get("transfer") or {})
    _only(tr_in, ["mode", "trainable_layers"], "transfer learning")
    mode = str(tr_in.get("mode") or "scratch")
    if mode not in TRANSFER_MODES:
        raise OptionsError(f"transfer mode must be one of {', '.join(TRANSFER_MODES)}")
    transfer = {"mode": mode}
    if mode == "fine_tune":
        transfer["trainable_layers"] = _num(tr_in.get("trainable_layers", 20), "Fine-tuned layers", 1, 300, integer=True)

    test_fraction = 0.0 if config.get("test_fraction") is None else _num(config["test_fraction"], "Test share", 0.0, 0.4)
    embargo_bars = 0 if config.get("embargo_bars") is None else _num(config["embargo_bars"], "Embargo", 0, 500, integer=True)
    horizon = config.get("label_horizon_bars")
    horizon = None if horizon is None else _num(horizon, "Label horizon", 1, 1000, integer=True)
    label_timeframe = config.get("label_timeframe")
    if label_timeframe is not None and label_timeframe not in ("1d", "1wk", "1mo"):
        raise OptionsError("label_timeframe must be 1d, 1wk or 1mo")

    method = config.get("validation_method") or ("random" if legacy else "chronological")
    out = {
        "protocol": protocol,
        "validation_method": method,
        "test_fraction": test_fraction,
        "evaluate_test": bool(config.get("evaluate_test", False)) and test_fraction > 0,
        "purge_chart_windows": config.get("purge_chart_windows") is not False,
        "embargo_bars": embargo_bars,
        "label_horizon_bars": horizon,
        "label_timeframe": label_timeframe,
        "optimizer": optimizer,
        "lr_schedule": schedule,
        "regularization": regularization,
        "early_stopping": early_stopping,
        "selection_metric": selection,
        "class_weighting": weighting,
        "augmentation": augmentation,
        "transfer": transfer,
        "deterministic_ops": bool(config.get("deterministic_ops", not legacy)),
    }
    if legacy:
        changed = [
            k
            for k in ("optimizer", "lr_schedule", "regularization", "early_stopping", "selection_metric",
                      "class_weighting", "augmentation", "transfer", "test_fraction")
            if config.get(k)
        ]
        if changed:
            raise OptionsError(f"Trainer protocol 1 runs do not support: {', '.join(changed)}")
    return out


def public_schema() -> Dict[str, Any]:
    """Defaults and choices for the Trainer page."""
    return {
        "protocol": PROTOCOL,
        "optimizers": OPTIMIZERS,
        "lr_schedules": SCHEDULES,
        "selection_metrics": list(SELECTION_METRICS),
        "class_weighting": list(CLASS_WEIGHTING),
        "augmentations": [{"id": k, **v} for k, v in AUGMENTATIONS.items()],
        "transfer_modes": list(TRANSFER_MODES),
        "early_stopping": {"patience": DEFAULT_PATIENCE, "min_delta": 0.0},
    }
