import os
import sys
import json
import time
import uuid
import threading
from pathlib import Path
from typing import Dict, Any, Callable, Optional
import subprocess
import select
import fcntl

from app.process_registry import kill_managed, popen_managed, running_processes
from app.paths import backtest_run_dir, find_backtest_dir, runs_root

# In-memory storage for backtest runs
backtest_runs = {}

METHODOLOGY_V1 = {
    "id": "label_payoff_v1",
    "version": 1,
    "label": "Legacy label-payoff estimate — not a price-based trading simulation.",
}
METHODOLOGY_V2 = {
    "id": "price_sim_v2",
    "version": 2,
    "label": "Price-based portfolio simulation on stored OHLC bars",
}


def methodology_of(info: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    """Runs created before methodology tracking are v1 label-payoff runs."""
    m = (info or {}).get("methodology")
    return m if isinstance(m, dict) and m.get("id") else METHODOLOGY_V1

def get_backtests_root() -> Path:
    """Legacy shared backtests directory (AUTH_REQUIRED=false / pre-namespaced)."""
    return runs_root() / "backtests"

def get_run_info(run_id: str) -> Optional[Dict[str, Any]]:
    """Get run info from memory or disk"""
    if run_id in backtest_runs:
        return backtest_runs[run_id]

    run_dir = find_backtest_dir(run_id)
    if run_dir and run_dir.exists():
        info_file = run_dir / "run_info.json"
        if info_file.exists():
            try:
                with open(info_file, 'r') as f:
                    info = json.load(f)
                    backtest_runs[run_id] = info
                    return info
            except Exception:
                pass
    return None

def save_run_info(run_id: str, info: Dict[str, Any]):
    """Save run info to memory and disk"""
    backtest_runs[run_id] = info

    user_id = info.get("user_id")
    run_dir = backtest_run_dir(run_id, user_id)
    run_dir.mkdir(parents=True, exist_ok=True)
    info_file = run_dir / "run_info.json"

    try:
        with open(info_file, 'w') as f:
            json.dump(info, f, indent=2)
    except Exception as e:
        print(f"Warning: Could not save run info to disk: {e}")

def update_run_status(run_id: str, status: str, progress: float = 0.0, message: str = "", logs: str = ""):
    """Update run status"""
    info = get_run_info(run_id)
    if info:
        info.update({
            "status": status,
            "progress": progress,
            "message": message,
            "logs": logs,
            "updated_at": time.time()
        })
        save_run_info(run_id, info)
    if status in ("succeeded", "failed", "cancelled"):
        _persist_terminal_state(run_id, status, progress, message)


def _persist_terminal_state(run_id: str, status: str, progress: float, message: str) -> None:
    """Record the terminal state in pipeline_runs so the orphan reconciler does not mark it interrupted."""
    try:
        from app.ownership import update_pipeline_run_state
        from app.services.backtest_api import strip_paths

        update_pipeline_run_state(run_id, status=status, progress=progress, stage=status, message=strip_paths(message or ""))
    except Exception as e:  # noqa: BLE001 — run_info.json remains the source of truth
        print(f"Warning: Could not record terminal state for {run_id}: {e}")

def parse_progress_from_output(line: str) -> Optional[tuple[float, str]]:
    """Parse progress from backtester output lines"""
    if line.startswith("PROGRESS "):
        parts = line.split(" ", 2)
        try:
            return float(parts[1]), (parts[2] if len(parts) > 2 else "")
        except ValueError:
            return None
    line_lower = line.lower()

    # Map specific messages to progress percentages
    progress_map = {
        "loading model": (0.10, "Loading model..."),
        "loading dataset": (0.25, "Loading dataset..."),
        "found": (0.35, "Processing data..."),
        "running backtest simulation": (0.55, "Running simulation..."),
        "generate charts": (0.90, "Generating charts..."),
        "backtest completed successfully": (1.00, "Completed successfully!"),
        "saving results": (0.95, "Saving results..."),
    }

    for key, (progress, message) in progress_map.items():
        if key in line_lower:
            return progress, message

    # Try to parse Keras progress (e.g., "1/100", "50/100")
    if '/' in line and any(char.isdigit() for char in line):
        parts = line.split('/')
        if len(parts) == 2:
            try:
                current = int(parts[0].strip())
                total = int(parts[1].strip())
                if total > 0:
                    # Map Keras progress to 55-80% range
                    keras_progress = 0.55 + (current / total) * 0.25
                    return keras_progress, f"Processing predictions... ({current}/{total})"
            except:
                pass

    return None

def run_backtester_realtime(run_id: str, config: Dict[str, Any]):
    """Run backtester with real-time progress and logging"""
    user_id = config.get("user_id")
    run_dir = backtest_run_dir(run_id, user_id)
    output_dir = run_dir / "output"
    output_dir.mkdir(parents=True, exist_ok=True)

    log_file = output_dir / "run.log"

    engine = "v2" if config.get("engine") == "v2" else "v1"
    run_info = {
        "run_id": run_id,
        "status": "running",
        "progress": 0.0,
        "message": "Starting backtester...",
        "logs": "",
        "started_at": time.time(),
        "config": config,
        "output_dir": str(output_dir),
        "user_id": user_id,
        "engine": engine,
        "methodology": METHODOLOGY_V2 if engine == "v2" else METHODOLOGY_V1,
    }
    if engine == "v1":
        run_info["ignored_parameters"] = ["max_trades_per_day"]
    save_run_info(run_id, run_info)

    backend_root = Path(__file__).resolve().parents[1]
    if engine == "v2":
        v2_config = {**config, "output_dir": str(output_dir), "run_id": run_id}
        cfg_path = run_dir / "v2_config.json"
        with open(cfg_path, "w") as f:
            json.dump(v2_config, f, indent=2)
        cmd = [sys.executable, str(backend_root / "scripts" / "backtest_v2.py"), "--config", str(cfg_path)]
    else:
        cmd = _v1_command(backend_root, config, output_dir)
    _execute(run_id, cmd, backend_root, output_dir)


def _v1_command(backend_root: Path, config: Dict[str, Any], output_dir: Path) -> list:
    script_path = backend_root / "scripts" / "3.2_Tester_Pro_v2.py"
    return [
        sys.executable,
        str(script_path),
        "--model_path", config["model_path"],
        "--dataset_path", config["dataset_path"],
        "--sample_size", str(config["sample_size"]),
        "--confidence_threshold", str(config["confidence_threshold"]),
        "--tp_pct", str(config["tp_pct"]),
        "--sl_pct", str(config["sl_pct"]),
        "--img_size", str(config["img_size"]),
        "--starting_capital", str(config["starting_capital"]),
        "--position_size_pct", str(config["position_size_pct"]),
        "--commission_pct", str(config["commission_pct"]),
        "--slippage_pct", str(config["slippage_pct"]),
        "--max_drawdown_pct", str(config["max_drawdown_pct"]),
        "--output_dir", str(output_dir)
    ]


def _execute(run_id: str, cmd: list, backend_root: Path, output_dir: Path) -> None:
    log_file = output_dir / "run.log"
    logs: list = []
    print(f"Starting backtester {run_id}")

    try:
        # Start the process (registered for cancel)
        process = popen_managed(
            run_id,
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            bufsize=1,
            cwd=str(backend_root),
        )

        # Make stdout/stderr non-blocking
        if process.stdout:
            fcntl.fcntl(process.stdout.fileno(), fcntl.F_SETFL, os.O_NONBLOCK)
        if process.stderr:
            fcntl.fcntl(process.stderr.fileno(), fcntl.F_SETFL, os.O_NONBLOCK)

        logs = []
        last_progress_update = 0

        while True:
            # Cancelled via unified cancel endpoint
            info = get_run_info(run_id)
            if info and str(info.get("status") or "").lower() in ("cancelled", "canceled"):
                kill_managed(run_id)
                update_run_status(run_id, "cancelled", 0, "Cancelled by user", "\n".join(logs[-50:]))
                return

            # Check if process is still running
            if process.poll() is not None:
                break

            # Read from stdout and stderr
            ready, _, _ = select.select([process.stdout, process.stderr], [], [], 0.1)

            for stream in ready:
                if stream == process.stdout:
                    line = process.stdout.readline()
                elif stream == process.stderr:
                    line = process.stderr.readline()
                else:
                    continue

                if line:
                    line = line.strip()
                    if line:
                        print(f"[BACKTEST {run_id}] {line}")
                        logs.append(f"{time.strftime('%H:%M:%S')} {line}")

                        # Write to log file
                        with open(log_file, 'a') as f:
                            f.write(f"{time.strftime('%Y-%m-%d %H:%M:%S')} {line}\n")

                        # Parse progress
                        progress_info = parse_progress_from_output(line)
                        if progress_info:
                            progress, message = progress_info
                            update_run_status(run_id, "running", progress, message, "\n".join(logs[-50:]))  # Keep last 50 lines
                            last_progress_update = time.time()

            # If no progress update in 10 seconds, show we're still working
            if time.time() - last_progress_update > 10:
                current_info = get_run_info(run_id)
                if current_info and current_info["status"] == "running":
                    update_run_status(run_id, "running", current_info["progress"], "Processing...", "\n".join(logs[-50:]))

            time.sleep(0.1)

        running_processes.pop(run_id, None)

        # Process finished
        return_code = process.returncode
        print(f"Backtester process finished with return code: {return_code}")

        # Read any remaining output
        if process.stdout:
            remaining = process.stdout.read()
            if remaining:
                for line in remaining.split('\n'):
                    if line.strip():
                        logs.append(f"{time.strftime('%H:%M:%S')} {line.strip()}")
                        with open(log_file, 'a') as f:
                            f.write(f"{time.strftime('%Y-%m-%d %H:%M:%S')} {line.strip()}\n")

        if process.stderr:
            remaining = process.stderr.read()
            if remaining:
                for line in remaining.split('\n'):
                    if line.strip():
                        logs.append(f"{time.strftime('%H:%M:%S')} ERROR: {line.strip()}")
                        with open(log_file, 'a') as f:
                            f.write(f"{time.strftime('%Y-%m-%d %H:%M:%S')} ERROR: {line.strip()}\n")

        # Update final status
        if return_code == 0:
            update_run_status(run_id, "succeeded", 1.0, "Completed successfully", "\n".join(logs[-50:]))
            print(f"Backtester {run_id} completed successfully")
        else:
            input_err = next((l.split("INPUT_ERROR:", 1)[1].strip() for l in reversed(logs) if "INPUT_ERROR:" in l), None)
            error_msg = input_err or f"Process exited with code {return_code}"
            if logs and not input_err:
                error_msg += f"\nLast output: {logs[-1]}"
            update_run_status(run_id, "failed", 0.0, error_msg, "\n".join(logs[-50:]))
            print(f"Backtester {run_id} failed: {error_msg}")

    except Exception as e:
        error_msg = f"Backtester failed: {str(e)}"
        update_run_status(run_id, "failed", 0.0, error_msg, "\n".join(logs[-50:]) if logs else "")
        print(f"Backtester {run_id} exception: {e}")
        raise
