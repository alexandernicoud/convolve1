from pathlib import Path

from app.paths import safe_resolve_under


def test_safe_resolve_allows_nested_file(tmp_path: Path):
    root = tmp_path / "out"
    nested = root / "charts"
    nested.mkdir(parents=True)
    target = nested / "a.png"
    target.write_bytes(b"ok")
    resolved = safe_resolve_under(root, "charts/a.png")
    assert resolved == target.resolve()


def test_safe_resolve_blocks_parent_traversal(tmp_path: Path):
    root = tmp_path / "out"
    root.mkdir()
    secret = tmp_path / "secret.txt"
    secret.write_text("nope")
    assert safe_resolve_under(root, "../secret.txt") is None
    assert safe_resolve_under(root, "charts/../../secret.txt") is None


def test_safe_resolve_blocks_absolute(tmp_path: Path):
    root = tmp_path / "out"
    root.mkdir()
    assert safe_resolve_under(root, "/etc/passwd") is None
