"""Epoch checkpoints for long training runs, and the rules for resuming from them.

A checkpoint is written after every completed epoch:

    checkpoint/
      epoch-0003.keras      model + optimizer state (Adam moments, iteration count)
      best.weights.npz      EarlyStopping's best weights, when it holds any
      state.json            written last; names the files above

Every file is written under a temporary name and renamed, and state.json is replaced only after
the files it points to exist, so a crash at any moment leaves either the previous checkpoint or
the new one, never a mix. Writing the same epoch twice produces the same files.

A checkpoint is only used when its owner, run id and experiment fingerprint (architecture, data
split, image size, batch size, epochs, seed, validation method, input pipeline, precision) all
match the run being started. Anything else is ignored and training starts from scratch.
"""

from __future__ import annotations

import hashlib
import json
import os
import time
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional

import numpy as np
import tensorflow as tf

CHECKPOINT_VERSION = 1
STATE_FILE = "state.json"
BEST_WEIGHTS_FILE = "best.weights.npz"


def fingerprint(spec: Dict[str, Any], train_names: List[str], val_names: List[str]) -> str:
    h = hashlib.sha256()
    h.update(json.dumps(spec, sort_keys=True, default=str).encode())
    for group in (train_names, val_names):
        h.update(b"\x00")
        for name in group:
            h.update(name.encode())
            h.update(b"\n")
    return h.hexdigest()


def _atomic_write_bytes(path: Path, data: bytes) -> None:
    tmp = path.with_name(f".{path.name}.tmp")
    tmp.write_bytes(data)
    os.replace(tmp, path)


def load_state(ckpt_dir: Path) -> Optional[Dict[str, Any]]:
    path = Path(ckpt_dir) / STATE_FILE
    if not path.is_file():
        return None
    try:
        state = json.loads(path.read_text())
    except (OSError, ValueError):
        return None
    return state if isinstance(state, dict) else None


def compatible_state(
    ckpt_dir: Path, *, run_id: str, user_id: Optional[str], fp: str
) -> Optional[Dict[str, Any]]:
    """The checkpoint state if it belongs to this run and experiment and its files are present."""
    state = load_state(ckpt_dir)
    if not state or state.get("version") != CHECKPOINT_VERSION:
        return None
    if state.get("run_id") != run_id or (state.get("user_id") or None) != (user_id or None):
        return None
    if state.get("fingerprint") != fp:
        return None
    model_file = Path(ckpt_dir) / str(state.get("model_file") or "")
    if not state.get("model_file") or not model_file.is_file():
        return None
    if state.get("best_weights_file") and not (Path(ckpt_dir) / state["best_weights_file"]).is_file():
        return None
    return state


class ResumableEarlyStopping(tf.keras.callbacks.EarlyStopping):
    """EarlyStopping whose counters survive a restart. Without restore_state it is EarlyStopping."""

    def __init__(self, *args, restore_state: Optional[Dict[str, Any]] = None, restore_best_weights_list=None, **kwargs):
        super().__init__(*args, **kwargs)
        self._restore_state = restore_state
        self._restore_best_weights_list = restore_best_weights_list

    def on_train_begin(self, logs=None):
        super().on_train_begin(logs)
        if self._restore_state:
            self.wait = int(self._restore_state.get("wait", 0))
            best = self._restore_state.get("best")
            self.best = float(best) if best is not None else self.best
            self.best_epoch = int(self._restore_state.get("best_epoch", 0))
            if self._restore_best_weights_list is not None:
                self.best_weights = self._restore_best_weights_list

    def snapshot(self) -> Dict[str, Any]:
        best = self.best
        return {
            "wait": int(self.wait),
            "best": None if best is None or not np.isfinite(best) else float(best),
            "best_epoch": int(self.best_epoch),
        }


class EpochCheckpoint(tf.keras.callbacks.Callback):
    """Writes the checkpoint after each completed epoch. Must run after EarlyStopping and the
    progress callback so the saved counters and history include the epoch just finished."""

    def __init__(
        self,
        ckpt_dir: Path,
        *,
        run_id: str,
        user_id: Optional[str],
        fp: str,
        early_stop: ResumableEarlyStopping,
        history: Callable[[], List[Dict[str, Any]]],
        epoch_timings: Callable[[], List[Dict[str, Any]]],
        is_cancelled: Callable[[], bool],
        on_saved: Optional[Callable[[Path, Dict[str, Any]], None]] = None,
        callback_states: Optional[Callable[[], Dict[str, Any]]] = None,
    ) -> None:
        super().__init__()
        self.ckpt_dir = Path(ckpt_dir)
        self.run_id = run_id
        self.user_id = user_id
        self.fp = fp
        self.early_stop = early_stop
        self.history = history
        self.epoch_timings = epoch_timings
        self.is_cancelled = is_cancelled
        self.on_saved = on_saved
        self.callback_states = callback_states
        self.save_seconds = 0.0

    def on_epoch_end(self, epoch, logs=None):
        if self.is_cancelled():
            return
        t0 = time.perf_counter()
        self.ckpt_dir.mkdir(parents=True, exist_ok=True)
        model_file = f"epoch-{epoch + 1:04d}.keras"
        tmp_model = self.ckpt_dir / f".{model_file}.tmp.keras"
        self.model.save(str(tmp_model))
        os.replace(tmp_model, self.ckpt_dir / model_file)
        best_file = None
        if self.early_stop.best_weights is not None:
            best_file = BEST_WEIGHTS_FILE
            tmp_best = self.ckpt_dir / f".{BEST_WEIGHTS_FILE}.tmp.npz"
            np.savez(tmp_best, *self.early_stop.best_weights)
            os.replace(tmp_best, self.ckpt_dir / BEST_WEIGHTS_FILE)
        state = {
            "version": CHECKPOINT_VERSION,
            "run_id": self.run_id,
            "user_id": self.user_id,
            "fingerprint": self.fp,
            "epochs_completed": epoch + 1,
            "model_file": model_file,
            "best_weights_file": best_file,
            "early_stopping": self.early_stop.snapshot(),
            "history": self.history(),
            "epoch_timings": self.epoch_timings(),
            "saved_at": time.time(),
        }
        if self.callback_states is not None:
            state["callbacks"] = self.callback_states()
        _atomic_write_bytes(self.ckpt_dir / STATE_FILE, json.dumps(state, indent=2).encode())
        for old in self.ckpt_dir.glob("epoch-*.keras"):
            if old.name != model_file:
                old.unlink(missing_ok=True)
        self.save_seconds += time.perf_counter() - t0
        if self.on_saved is not None:
            self.on_saved(self.ckpt_dir, state)


def load_best_weights(ckpt_dir: Path, state: Dict[str, Any]) -> Optional[List[np.ndarray]]:
    name = state.get("best_weights_file")
    if not name:
        return None
    with np.load(Path(ckpt_dir) / name) as data:
        return [data[f"arr_{i}"] for i in range(len(data.files))]


def checkpoint_files(ckpt_dir: Path, state: Dict[str, Any]) -> List[Path]:
    """The files that make up the checkpoint described by state, state.json last."""
    root = Path(ckpt_dir)
    files = [root / state["model_file"]]
    if state.get("best_weights_file"):
        files.append(root / state["best_weights_file"])
    files.append(root / STATE_FILE)
    return files
