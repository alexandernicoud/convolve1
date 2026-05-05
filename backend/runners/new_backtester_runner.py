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

# In-memory storage for backtest runs
backtest_runs = {}

def get_backtests_root() -> Path:
    root_dir = Path(__file__).resolve().parents[2]
    return root_dir / "backend" / "runs" / "backtests"

def get_run_info(run_id: str) -> Optional[Dict[str, Any]]:
    """Get run info from memory or disk"""
    if run_id in backtest_runs:
        return backtest_runs[run_id]

    # Try to load from disk
    run_dir = get_backtests_root() / run_id
    if run_dir.exists():
        info_file = run_dir / "run_info.json"
        if info_file.exists():
            try:
                with open(info_file, 'r') as f:
                    info = json.load(f)
                    backtest_runs[run_id] = info
                    return info
            except:
                pass
    return None

def save_run_info(run_id: str, info: Dict[str, Any]):
    """Save run info to memory and disk"""
    backtest_runs[run_id] = info

    # Save to disk
    run_dir = get_backtests_root() / run_id
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

def parse_progress_from_output(line: str) -> Optional[tuple[float, str]]:
    """Parse progress from backtester output lines"""
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
    run_dir = get_backtests_root() / run_id
    output_dir = run_dir / "output"
    output_dir.mkdir(parents=True, exist_ok=True)

    log_file = output_dir / "run.log"

    # Initialize run info
    run_info = {
        "run_id": run_id,
        "status": "running",
        "progress": 0.0,
        "message": "Starting backtester...",
        "logs": "",
        "started_at": time.time(),
        "config": config,
        "output_dir": str(output_dir)
    }
    save_run_info(run_id, run_info)

    # Build command
    # Get the path to the backtester script in the root directory
    root_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    script_path = os.path.join(root_dir, "3.2_Tester_Pro_v2.py")

    cmd = [
        sys.executable,
        script_path,
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

    print(f"Starting backtester: {' '.join(cmd)}")

    try:
        # Start the process
        process = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            bufsize=1,
            cwd=root_dir
        )

        # Make stdout/stderr non-blocking
        if process.stdout:
            fcntl.fcntl(process.stdout.fileno(), fcntl.F_SETFL, os.O_NONBLOCK)
        if process.stderr:
            fcntl.fcntl(process.stderr.fileno(), fcntl.F_SETFL, os.O_NONBLOCK)

        logs = []
        last_progress_update = 0

        while True:
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
            error_msg = f"Process exited with code {return_code}"
            if logs:
                error_msg += f"\nLast output: {logs[-1]}"
            update_run_status(run_id, "failed", 0.0, error_msg, "\n".join(logs[-50:]))
            print(f"Backtester {run_id} failed: {error_msg}")

    except Exception as e:
        error_msg = f"Backtester failed: {str(e)}"
        update_run_status(run_id, "failed", 0.0, error_msg, "\n".join(logs[-50:]) if logs else "")
        print(f"Backtester {run_id} exception: {e}")
        raise
