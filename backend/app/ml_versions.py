"""Installed TensorFlow/Keras must equal the pins in requirements.txt.

Keras 3.14 cannot load models saved by 3.15, so the trainer, the API and the bot
runner have to run the same versions. Images copy requirements.txt next to the
app, which lets every process compare itself against the pins at start.
"""

from __future__ import annotations

import re
from importlib import metadata
from pathlib import Path
from typing import Dict, List, Optional

PINNED_PACKAGES = ("tensorflow", "keras")
REQUIREMENTS_PATH = Path(__file__).resolve().parent.parent / "requirements.txt"
_PIN = re.compile(r"^\s*([A-Za-z0-9_.\-]+)\s*==\s*([^\s;#]+)")


def pinned_versions(requirements: Path = REQUIREMENTS_PATH) -> Dict[str, str]:
    pins: Dict[str, str] = {}
    if not requirements.is_file():
        return pins
    for line in requirements.read_text(encoding="utf-8").splitlines():
        match = _PIN.match(line)
        if match and match.group(1).lower() in PINNED_PACKAGES:
            pins[match.group(1).lower()] = match.group(2)
    return pins


def installed_version(package: str) -> Optional[str]:
    try:
        return metadata.version(package)
    except metadata.PackageNotFoundError:
        return None


def version_mismatches(requirements: Path = REQUIREMENTS_PATH) -> List[str]:
    """Human-readable problems; empty when every pinned ML package matches."""
    pins = pinned_versions(requirements)
    problems = [f"{name} is not pinned in {requirements.name}" for name in PINNED_PACKAGES if name not in pins]
    for name, wanted in sorted(pins.items()):
        have = installed_version(name)
        if have != wanted:
            problems.append(f"{name} {have or 'missing'} installed, {wanted} pinned")
    return problems


def describe() -> str:
    return ", ".join(f"{name}={installed_version(name) or 'missing'}" for name in PINNED_PACKAGES)
