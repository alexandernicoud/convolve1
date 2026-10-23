"""
Dataset provenance: per-sample outcome metadata and the OHLCV bars they were computed from.

Layout (inside a dataset folder, next to ``images/``)::

    provenance/
      provenance.json      dataset-level parameters, conventions, data source, file hashes
      samples.jsonl        one record per image (decision time, outcome, label, ...)
      ohlcv/<SYMBOL>.csv   bars as downloaded: ISO timestamp with UTC offset, OHLCV
      dataset_manifest.json  dataset id + image fingerprint (written at registration)

Datasets without this folder are legacy: their outcomes cannot be reproduced from stored data.
"""

from __future__ import annotations

import csv
import hashlib
import json
import os
import re
import time
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional

import pandas as pd

PROVENANCE_SCHEMA_VERSION = 1
PROVENANCE_DIR = "provenance"
STAGING_DIR = "_provenance"
OHLCV_COLUMNS = ("Open", "High", "Low", "Close", "Volume")
PRICE_ADJUSTMENT_YF = "yfinance_auto_adjust"  # Ticker.history default: split- and dividend-adjusted OHLC
_SYMBOL_RE = re.compile(r"[A-Za-z0-9][A-Za-z0-9.^=_-]{0,31}")


def _sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def dataset_fingerprint(images_dir: str | os.PathLike) -> Optional[str]:
    """sha256 over sorted (basename, file sha256) of every PNG; None when there are no images."""
    d = Path(images_dir)
    if not d.is_dir():
        return None
    names = sorted(p.name for p in d.iterdir() if p.suffix.lower() == ".png" and not p.name.startswith("._"))
    if not names:
        return None
    h = hashlib.sha256()
    for n in names:
        h.update(n.encode())
        h.update(b"\0")
        h.update(_sha256_file(d / n).encode())
        h.update(b"\n")
    return h.hexdigest()


class ProvenanceWriter:
    """Collects samples and price histories during generation; writes them to ``<out_dir>/_provenance``."""

    def __init__(self, out_dir: str | os.PathLike, params: Dict[str, Any]):
        self.root = Path(out_dir) / STAGING_DIR
        self.params = dict(params)
        self.samples: List[Dict[str, Any]] = []
        self.histories: Dict[str, Dict[str, Any]] = {}
        self.skipped: Dict[str, int] = {}
        self.notes: List[str] = []

    def add_history(self, symbol: str, bars: pd.DataFrame, role: str = "sample") -> None:
        if not _SYMBOL_RE.fullmatch(symbol or ""):
            raise ValueError(f"Unsupported symbol for storage: {symbol!r}")
        self.root.joinpath("ohlcv").mkdir(parents=True, exist_ok=True)
        path = self.root / "ohlcv" / f"{symbol}.csv"
        cols = [c for c in OHLCV_COLUMNS if c in bars.columns]
        with open(path, "w", newline="") as f:
            wr = csv.writer(f)
            wr.writerow(["timestamp", *cols])
            for ts, row in zip(bars.index, bars[cols].itertuples(index=False)):
                wr.writerow([pd.Timestamp(ts).isoformat(), *[repr(float(v)) for v in row]])
        tz = getattr(bars.index, "tz", None)
        self.histories[symbol] = {
            "file": f"ohlcv/{symbol}.csv",
            "role": role,
            "rows": int(len(bars)),
            "first": pd.Timestamp(bars.index[0]).isoformat() if len(bars) else None,
            "last": pd.Timestamp(bars.index[-1]).isoformat() if len(bars) else None,
            "timezone": str(tz) if tz is not None else None,
            "columns": cols,
            "sha256": _sha256_file(path),
        }

    def add_sample(self, record: Dict[str, Any]) -> None:
        self.samples.append(record)

    def skip(self, reason: str) -> None:
        self.skipped[reason] = self.skipped.get(reason, 0) + 1

    def write(self) -> Path:
        self.root.mkdir(parents=True, exist_ok=True)
        with open(self.root / "samples.jsonl", "w") as f:
            for r in self.samples:
                f.write(json.dumps(r, default=str) + "\n")
        meta = {
            "schema_version": PROVENANCE_SCHEMA_VERSION,
            "created_at": time.time(),
            **self.params,
            "n_samples": len(self.samples),
            "skipped_windows": self.skipped,
            "market_data": self.histories,
            "notes": self.notes,
        }
        with open(self.root / "provenance.json", "w") as f:
            json.dump(meta, f, indent=2, default=str)
        return self.root


# ---------------------------------------------------------------------------
# Readers
# ---------------------------------------------------------------------------


def provenance_dir(dataset_dir: str | os.PathLike) -> Optional[Path]:
    """``<dataset>/provenance`` when it holds a provenance.json; accepts the dataset or its images dir."""
    d = Path(dataset_dir)
    for cand in (d / PROVENANCE_DIR, d.parent / PROVENANCE_DIR):
        if (cand / "provenance.json").is_file():
            return cand
    return None


def load_provenance(dataset_dir: str | os.PathLike) -> Optional[Dict[str, Any]]:
    p = provenance_dir(dataset_dir)
    if not p:
        return None
    try:
        with open(p / "provenance.json") as f:
            meta = json.load(f)
    except (OSError, json.JSONDecodeError):
        return None
    return meta if isinstance(meta, dict) else None


def load_samples(dataset_dir: str | os.PathLike) -> List[Dict[str, Any]]:
    p = provenance_dir(dataset_dir)
    if not p or not (p / "samples.jsonl").is_file():
        return []
    out = []
    with open(p / "samples.jsonl") as f:
        for line in f:
            line = line.strip()
            if line:
                out.append(json.loads(line))
    return out


def load_ohlcv(dataset_dir: str | os.PathLike, symbol: str, verify: bool = True) -> Optional[pd.DataFrame]:
    """Stored bars for ``symbol`` (tz-aware index). Raises ValueError if the file hash changed."""
    p = provenance_dir(dataset_dir)
    meta = load_provenance(dataset_dir)
    if not p or not meta:
        return None
    entry = (meta.get("market_data") or {}).get(symbol)
    if not entry or not _SYMBOL_RE.fullmatch(symbol or ""):
        return None
    path = p / "ohlcv" / f"{symbol}.csv"
    if not path.is_file():
        return None
    if verify and entry.get("sha256") and _sha256_file(path) != entry["sha256"]:
        raise ValueError(f"Stored market data for {symbol} does not match its recorded hash")
    df = pd.read_csv(path, float_precision="round_trip")
    idx = pd.DatetimeIndex(pd.to_datetime(df.pop("timestamp"), utc=True))
    if entry.get("timezone"):
        idx = idx.tz_convert(entry["timezone"])
    df.index = pd.DatetimeIndex(idx, name="timestamp")
    return df.astype(float)


def finalize_into_dataset(staging_root: Path, dataset_path: Path, dataset_id: str) -> Optional[Dict[str, Any]]:
    """Copy staged provenance into the dataset and pin it to the registered images."""
    import shutil

    if not (staging_root / "provenance.json").is_file():
        return None
    dest = dataset_path / PROVENANCE_DIR
    if dest.exists():
        shutil.rmtree(dest)
    shutil.copytree(staging_root, dest)
    images = dataset_path / "images"
    present = {p.name for p in images.glob("*.png")} if images.is_dir() else set()
    samples = load_samples(dataset_path)
    manifest = {
        "dataset_id": dataset_id,
        "fingerprint": dataset_fingerprint(images),
        "n_images": len(present),
        "n_samples": len(samples),
        "samples_without_image": sum(1 for s in samples if s.get("image_id") not in present),
        "images_without_sample": len(present - {s.get("image_id") for s in samples}),
    }
    with open(dest / "dataset_manifest.json", "w") as f:
        json.dump(manifest, f, indent=2)
    return manifest


def iter_symbols(meta: Dict[str, Any], role: Optional[str] = None) -> Iterable[str]:
    for sym, entry in (meta.get("market_data") or {}).items():
        if role is None or entry.get("role") == role:
            yield sym
