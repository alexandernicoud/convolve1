"""Every image that trains or loads models must run the pinned TensorFlow/Keras."""

from __future__ import annotations

import logging
from pathlib import Path

from app import ml_versions
from app.jobs import run_due_bots, train_worker

BACKEND = Path(__file__).resolve().parent.parent


def _requirements(tmp_path: Path, text: str) -> Path:
    path = tmp_path / "requirements.txt"
    path.write_text(text, encoding="utf-8")
    return path


def test_pins_are_read_from_requirements(tmp_path):
    req = _requirements(tmp_path, "fastapi==0.104.1\ntensorflow==2.21.0  # cpu\nKeras == 3.15.1\n")
    assert ml_versions.pinned_versions(req) == {"tensorflow": "2.21.0", "keras": "3.15.1"}


def test_unpinned_or_mismatched_versions_are_reported(tmp_path, monkeypatch):
    monkeypatch.setattr(ml_versions, "installed_version", lambda name: {"tensorflow": "2.21.0", "keras": "3.14.0"}[name])
    req = _requirements(tmp_path, "tensorflow==2.21.0\nkeras==3.15.1\n")
    assert ml_versions.version_mismatches(req) == ["keras 3.14.0 installed, 3.15.1 pinned"]
    loose = _requirements(tmp_path, "tensorflow>=2.16\nkeras==3.14.0\n")
    assert ml_versions.version_mismatches(loose) == ["tensorflow is not pinned in requirements.txt"]


def test_this_environment_matches_the_pins():
    assert ml_versions.version_mismatches() == []


def test_docker_image_installs_the_pinned_requirements():
    dockerfile = (BACKEND / "Dockerfile").read_text(encoding="utf-8")
    assert "pip install --no-cache-dir -r requirements.txt" in dockerfile
    assert "COPY . ." in dockerfile


def test_trainer_check_fails_on_mismatch(monkeypatch):
    monkeypatch.setattr(ml_versions, "version_mismatches", lambda *a: ["keras 3.14.0 installed, 3.15.1 pinned"])
    assert train_worker.check_access() == 1


def test_bot_runner_logs_mismatch(monkeypatch, caplog):
    monkeypatch.setattr(ml_versions, "version_mismatches", lambda *a: ["keras 3.14.0 installed, 3.15.1 pinned"])
    monkeypatch.setattr(run_due_bots, "configure_logging", lambda: None, raising=False)
    monkeypatch.setattr(run_due_bots, "run_due_bots_once", lambda: {"success": 0, "error": 0})
    with caplog.at_level(logging.ERROR, logger=run_due_bots.logger.name):
        assert run_due_bots.main() == 0
    assert "keras 3.14.0 installed" in caplog.text
