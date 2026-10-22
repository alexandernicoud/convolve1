from pathlib import Path

from fastapi.testclient import TestClient


def test_backtest_files_reject_traversal(client: TestClient, user_a, tmp_path: Path, monkeypatch):
    from tests.conftest import mint_token
    from app.db import SessionLocal
    from app.models import PipelineRun
    import runners.new_backtester_runner as nbr

    run_id = "bt-traverse-1"
    out = tmp_path / "run-out"
    out.mkdir()
    (out / "ok.txt").write_text("inside")
    (tmp_path / "secret.txt").write_text("outside")

    token = mint_token(user_a)
    client.get("/api/me", headers={"Authorization": f"Bearer {token}"})
    db = SessionLocal()
    try:
        db.add(PipelineRun(id=run_id, user_id=user_a, tool="backtester", status="running"))
        db.commit()
    finally:
        db.close()

    monkeypatch.setattr(
        nbr,
        "get_run_info",
        lambda rid: {"output_dir": str(out)} if rid == run_id else None,
    )

    headers = {"Authorization": f"Bearer {token}"}
    ok = client.get(f"/api/backtests/{run_id}/files/ok.txt", headers=headers)
    assert ok.status_code == 200

    denied = client.get(f"/api/backtests/{run_id}/files/charts/../../secret.txt", headers=headers)
    assert denied.status_code == 404
