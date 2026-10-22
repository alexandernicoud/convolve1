"""
Assign historical USER_ID / NULL / unowned resources to a real Supabase Auth UUID.

Does not invent a UUID. You must pass the founder account id after they sign up.

  cd backend
  python -m app.services.legacy_cutover --user-id <supabase-auth-uuid>
  python -m app.services.legacy_cutover --user-id <uuid> --apply

Default is dry-run. Does not delete data. Does not move filesystem or GCS objects.
Bot child rows (runs, trades, equity snapshots) follow the parent bot via bot_id.
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional

from sqlalchemy import or_

from app.config import MODEL_STORAGE_ROOT, USER_ID, configure_logging
from app.db import SessionLocal, init_db
from app.models import Bot, PipelineRun, Profile, UserDataset, UserModel
from app.paths import (
    datasets_root,
    is_user_uuid,
    iter_backtest_dirs,
    iter_dataset_dirs,
    iter_run_dirs,
)

logger = logging.getLogger("legacy-cutover")


def _read_json(path: Path) -> Dict[str, Any]:
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError, TypeError):
        return {}


def _infer_run_tool(path: Path, fallback: str = "unknown") -> str:
    manifest = _read_json(path / "run_manifest.json")
    if isinstance(manifest.get("tool"), str) and manifest["tool"]:
        return str(manifest["tool"])
    if (path / "generator_config.json").is_file() or (path / f"training-dataset-{path.name}.zip").is_file():
        return "training-chart-generator"
    if (path / "testdata_results.json").is_file() or (path / "testdata_config.json").is_file():
        return "testdata"
    if (path / "optimizer_config.json").is_file():
        return "labeling-optimizer"
    if (path / "analysis_context.json").is_file():
        return "analysis"
    if (path / "model_metadata.json").is_file():
        return "trainer"
    return fallback


def _remaining_unmigratable() -> Dict[str, Any]:
    flat_runs: List[str] = []
    for name, path, owner in iter_run_dirs():
        if owner is None:
            flat_runs.append(str(path))
    flat_backtests: List[str] = []
    for name, path, owner in iter_backtest_dirs():
        if owner is None:
            flat_backtests.append(str(path))
    flat_datasets: List[str] = []
    for name, path, owner in iter_dataset_dirs():
        if owner is None:
            flat_datasets.append(str(path))
    keras_root = Path(MODEL_STORAGE_ROOT)
    flat_keras: List[str] = []
    if keras_root.is_dir():
        for f in sorted(keras_root.glob("*.keras")):
            flat_keras.append(str(f))
    return {
        "filesystem_run_dirs_remain_unnamespaced": flat_runs,
        "filesystem_backtest_dirs_remain_unnamespaced": flat_backtests,
        "dataset_dirs_remain_unnamespaced": flat_datasets,
        "keras_files_remain_unnamespaced": flat_keras,
        "gcs_objects": (
            "Existing keras/{model_id}.keras and models/{bot_id}.keras keys are not moved. "
            "New uploads use keras/{user_id}/{model_id}.keras. Re-upload or copy objects "
            "manually after cutover if namespaced keys are required."
        ),
        "bot_model_files": (
            "BOT_DATA_DIR/models/{bot_id}.keras copies are not moved into "
            "BOT_DATA_DIR/models/{user_id}/. API access is scoped by bots.user_id."
        ),
        "library_labels": (
            "backend/library_labels.json is not rewritten. New labels are keyed by "
            "{user_id}:{kind}:{id}; legacy global keys stay until edited again."
        ),
    }


def assign_legacy_resources(target_user_id: str, *, apply: bool = False) -> dict:
    try:
        target = uuid.UUID(str(target_user_id))
    except (ValueError, TypeError) as exc:
        raise ValueError("target user id must be a UUID from Supabase Auth (JWT sub)") from exc

    target_str = str(target)
    db = SessionLocal()
    try:
        profile = db.get(Profile, target)
        if profile is None:
            raise ValueError(
                f"No profiles row for {target_str}. Sign in once as that user first "
                "(or wait for the API to upsert the profile)."
            )

        bots = (
            db.query(Bot)
            .filter(or_(Bot.user_id == USER_ID, Bot.user_id.is_(None)))
            .all()
        )
        already_bots = db.query(Bot).filter(Bot.user_id == target_str).count()

        run_candidates: List[Dict[str, Any]] = []
        skipped_owned_runs: List[str] = []
        for name, path, owner in list(iter_run_dirs()) + [
            (n, p, o) for n, p, o in iter_backtest_dirs()
        ]:
            existing = db.get(PipelineRun, name)
            if existing is not None:
                if str(existing.user_id) != target_str:
                    skipped_owned_runs.append(name)
                continue
            if owner is not None and owner != target_str:
                skipped_owned_runs.append(name)
                continue
            tool = _infer_run_tool(path, "backtester" if "backtests" in path.parts else "unknown")
            run_candidates.append({"run_id": name, "tool": tool, "path": str(path)})

        dataset_candidates: List[Dict[str, Any]] = []
        skipped_owned_datasets: List[str] = []
        for name, path, owner in iter_dataset_dirs():
            existing = db.get(UserDataset, name)
            if existing is not None:
                if str(existing.user_id) != target_str:
                    skipped_owned_datasets.append(name)
                continue
            if owner is not None and owner != target_str:
                skipped_owned_datasets.append(name)
                continue
            summary = _read_json(path / "summary.json")
            dataset_candidates.append(
                {
                    "dataset_id": name,
                    "source": summary.get("source") or "legacy",
                    "path": str(path),
                }
            )

        model_candidates: List[Dict[str, Any]] = []
        skipped_owned_models: List[str] = []
        keras_root = Path(MODEL_STORAGE_ROOT)
        keras_files: List[Path] = []
        if keras_root.is_dir():
            keras_files.extend(sorted(keras_root.glob("*.keras")))
            for child in keras_root.iterdir():
                if child.is_dir() and is_user_uuid(child.name):
                    if child.name != target_str:
                        continue
                    keras_files.extend(sorted(child.glob("*.keras")))
        for f in keras_files:
            mid = f.stem
            existing = db.get(UserModel, mid)
            if existing is not None:
                if str(existing.user_id) != target_str:
                    skipped_owned_models.append(mid)
                continue
            parent = f.parent.name
            if is_user_uuid(parent) and parent != target_str:
                skipped_owned_models.append(mid)
                continue
            sidecar = _read_json(f.with_name(f"{mid}.metadata.json"))
            model_candidates.append(
                {
                    "model_id": mid,
                    "source": sidecar.get("source") or "legacy-upload",
                    "path": str(f),
                    "storage_key": (
                        f"keras/{parent}/{mid}.keras" if is_user_uuid(parent) else f"keras/{mid}.keras"
                    ),
                }
            )

        summary = {
            "legacy_user_id": USER_ID,
            "target_user_id": target_str,
            "applied": False,
            "bots_matched": len(bots),
            "bot_ids": [b.id for b in bots],
            "bots_already_on_target": already_bots,
            "pipeline_runs_to_record": len(run_candidates),
            "pipeline_run_ids": [r["run_id"] for r in run_candidates],
            "pipeline_runs_skipped_other_owner": skipped_owned_runs,
            "datasets_to_record": len(dataset_candidates),
            "dataset_ids": [d["dataset_id"] for d in dataset_candidates],
            "datasets_skipped_other_owner": skipped_owned_datasets,
            "models_to_record": len(model_candidates),
            "model_ids": [m["model_id"] for m in model_candidates],
            "models_skipped_other_owner": skipped_owned_models,
            "not_automatically_migratable": _remaining_unmigratable(),
        }

        if not apply:
            summary["message"] = "Dry run. Re-run with --apply to write ownership metadata. Files are not moved."
            return summary

        for bot in bots:
            bot.user_id = target_str
            db.add(bot)

        for row in run_candidates:
            if db.get(PipelineRun, row["run_id"]) is not None:
                continue
            db.add(
                PipelineRun(
                    id=row["run_id"],
                    user_id=target,
                    tool=row["tool"],
                    status="succeeded",
                    extra_json=json.dumps({"cutover": True, "path": row["path"]}),
                )
            )

        for row in dataset_candidates:
            if db.get(UserDataset, row["dataset_id"]) is not None:
                continue
            db.add(
                UserDataset(
                    id=row["dataset_id"],
                    user_id=target,
                    source=row["source"],
                    kind="legacy",
                    path=row["path"],
                )
            )

        for row in model_candidates:
            if db.get(UserModel, row["model_id"]) is not None:
                continue
            db.add(
                UserModel(
                    id=row["model_id"],
                    user_id=target,
                    source=row["source"],
                    storage_key=row["storage_key"],
                    path=row["path"],
                )
            )

        db.commit()
        summary["applied"] = True
        summary["message"] = (
            f"Updated {len(bots)} bot row(s), recorded {len(run_candidates)} pipeline run(s), "
            f"{len(dataset_candidates)} dataset(s), {len(model_candidates)} model(s). "
            "Filesystem/GCS objects were not moved."
        )
        summary["not_automatically_migratable"] = _remaining_unmigratable()
        return summary
    finally:
        db.close()


def assign_legacy_bots(target_user_id: str, *, apply: bool = False) -> dict:
    """Backward-compatible wrapper used by older docs/scripts."""
    return assign_legacy_resources(target_user_id, apply=apply)


def main(argv: Optional[list[str]] = None) -> int:
    configure_logging()
    parser = argparse.ArgumentParser(
        description="Assign prod-user/local-user and unowned resources to a Supabase UUID"
    )
    parser.add_argument("--user-id", required=True, help="Founder Supabase Auth UUID (do not invent)")
    parser.add_argument("--apply", action="store_true", help="Persist changes (default is dry-run)")
    args = parser.parse_args(argv)
    init_db()
    try:
        summary = assign_legacy_resources(args.user_id, apply=args.apply)
    except ValueError as exc:
        logger.error("%s", exc)
        print(exc, file=sys.stderr)
        return 2
    print(json.dumps(summary, indent=2, default=str))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
