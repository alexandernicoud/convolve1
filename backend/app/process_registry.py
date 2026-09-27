"""Shared subprocess registry so any tool run can be cancelled by run_id."""

from __future__ import annotations

import os
import signal
import subprocess
import time
from typing import Dict, List, Optional

running_processes: Dict[str, subprocess.Popen] = {}


def _new_session_kwargs() -> dict:
    """Put the child in its own process group so we can kill the whole tree."""
    if os.name == "nt":
        # CREATE_NEW_PROCESS_GROUP = 0x00000200
        return {"creationflags": getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0)}
    return {"start_new_session": True}


def popen_managed(run_id: str, cmd: List[str], **kwargs) -> subprocess.Popen:
    """Start a subprocess and register it under run_id for later cancel."""
    # Drop any previous stale handle for this id
    running_processes.pop(run_id, None)
    merged = {**_new_session_kwargs(), **kwargs}
    proc = subprocess.Popen(cmd, **merged)
    running_processes[run_id] = proc
    return proc


def kill_managed(run_id: str, grace_s: float = 5.0) -> bool:
    """Terminate a registered process (and its process group). Returns True if a live process was targeted."""
    proc = running_processes.pop(run_id, None)
    if proc is None:
        return False
    if proc.poll() is not None:
        return False

    pid = proc.pid
    try:
        if os.name != "nt" and pid:
            try:
                os.killpg(pid, signal.SIGTERM)
            except (ProcessLookupError, PermissionError):
                proc.terminate()
        else:
            proc.terminate()

        try:
            proc.wait(timeout=grace_s)
        except subprocess.TimeoutExpired:
            if os.name != "nt" and pid:
                try:
                    os.killpg(pid, signal.SIGKILL)
                except (ProcessLookupError, PermissionError):
                    proc.kill()
            else:
                proc.kill()
            try:
                proc.wait(timeout=3)
            except subprocess.TimeoutExpired:
                pass
        return True
    except Exception as exc:
        print(f"Error killing process for run {run_id}: {exc}")
        try:
            proc.kill()
        except Exception:
            pass
        return True


def wait_managed(run_id: str, proc: subprocess.Popen, timeout_s: Optional[float] = None) -> int:
    """Wait until the process exits (or timeout → kill). Clears registry entry when done."""
    start = time.time()
    try:
        while True:
            ret = proc.poll()
            if ret is not None:
                return int(ret)
            if timeout_s is not None and (time.time() - start) > timeout_s:
                kill_managed(run_id)
                return -1
            time.sleep(0.4)
    finally:
        if running_processes.get(run_id) is proc:
            running_processes.pop(run_id, None)


def is_process_alive(run_id: str) -> bool:
    proc = running_processes.get(run_id)
    return bool(proc and proc.poll() is None)
