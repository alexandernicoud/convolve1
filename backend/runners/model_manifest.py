"""Model manifest: the lineage and contract of a trained model, stored twice:

    <run>/model_manifest.json        next to the model in the run directory (durable store)
    <model>.keras :: convolve_manifest.json   inside the model archive itself

The copy inside the archive travels with a downloaded model, so lineage survives a download and
re-upload without relying on the file name. Keras ignores archive members it does not know, so
the model loads exactly as before. An embedded manifest is the uploader's claim: it is only
treated as verified when its run belongs to the uploader and the weights digest matches.

No TensorFlow import.
"""

from __future__ import annotations

import hashlib
import json
import zipfile
from pathlib import Path
from typing import Any, Dict, Optional

MANIFEST_VERSION = 1
MANIFEST_KIND = "convolve.trained_model"
MANIFEST_MEMBER = "convolve_manifest.json"
SIDECAR = "model_manifest.json"


def file_sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def embed(model_path: Path, manifest: Dict[str, Any]) -> bool:
    if not zipfile.is_zipfile(model_path):
        return False
    with zipfile.ZipFile(model_path, "a", compression=zipfile.ZIP_DEFLATED) as z:
        if MANIFEST_MEMBER in z.namelist():
            return False
        z.writestr(MANIFEST_MEMBER, json.dumps(manifest, indent=2, default=str))
    return True


def read_embedded(model_path: Path) -> Optional[Dict[str, Any]]:
    try:
        with zipfile.ZipFile(model_path) as z:
            if MANIFEST_MEMBER not in z.namelist():
                return None
            data = json.loads(z.read(MANIFEST_MEMBER))
    except (zipfile.BadZipFile, OSError, ValueError, KeyError):
        return None
    if not isinstance(data, dict) or data.get("kind") != MANIFEST_KIND:
        return None
    return data


def read_sidecar(run_dir: Path) -> Optional[Dict[str, Any]]:
    try:
        data = json.loads((Path(run_dir) / SIDECAR).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    return data if isinstance(data, dict) else None
