#!/usr/bin/env python3
"""Regenerate favicons and PWA icons from src/assets/convolve-mark.png.

Run from the repo root:
  python3 scripts/generate-brand-assets.py

The Open Graph image is rendered separately by scripts/og/render.mjs.
"""
from __future__ import annotations

import base64
import io
import struct
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
MARK = Image.open(ROOT / "src/assets/convolve-mark.png").convert("RGBA")
OUT = ROOT / "public"
BG = (5, 5, 6, 255)


# The source PNG carries a faint glow (alpha < 32) reaching far beyond the symbol. Cropping to
# the full alpha box shrank the white mark to about half of every icon, so crop to the solid mark.
HALO_ALPHA = 32


def solid_mark() -> Image.Image:
    mark = MARK.copy()
    alpha = mark.split()[-1].point(lambda v: 0 if v < HALO_ALPHA else v)
    mark.putalpha(alpha)
    bbox = alpha.getbbox()
    return mark.crop(bbox) if bbox else mark


SOLID = solid_mark()


def square_icon(size: int, pad_ratio: float = 0.08) -> Image.Image:
    """The white mark centred on the dark tile; ``pad_ratio`` is the margin above and below it."""
    scale = 8 if size < 64 else 2
    big = size * scale
    canvas = Image.new("RGBA", (big, big), BG)
    inner = max(1, round(big * (1 - 2 * pad_ratio)))
    fit = inner / max(SOLID.size)
    mark = SOLID.resize((max(1, round(SOLID.width * fit)), max(1, round(SOLID.height * fit))), Image.Resampling.LANCZOS)
    canvas.alpha_composite(mark, ((big - mark.width) // 2, (big - mark.height) // 2))
    return canvas.resize((size, size), Image.Resampling.LANCZOS)


def mark_height(img: Image.Image) -> int:
    """Rendered height of the white mark, as measured on the final tile."""
    tile = Image.new("RGBA", img.size, BG)
    tile.alpha_composite(img.convert("RGBA"))
    box = tile.convert("L").point(lambda v: 255 if v > 60 else 0).getbbox()
    return box[3] - box[1] if box else 0


# Visible mark height per icon size: the midpoint between the original icons (mark too small)
# and the first enlargement (too large on small sizes).
MARK_HEIGHT = {16: 13, 32: 24, 48: 36, 180: 126, 192: 134, 256: 195, 512: 320}


def sized_icon(size: int) -> Image.Image:
    """The tile whose rendered mark height is closest to MARK_HEIGHT[size]."""
    target = MARK_HEIGHT[size]
    best = None
    for step in range(0, 400):
        img = square_icon(size, step / 1000)
        err = abs(mark_height(img) - target)
        if best is None or err < best[0]:
            best = (err, img)
        if err == 0:
            break
    return best[1]


CORNER_RATIO = 0.22


def rounded(img: Image.Image, ratio: float = CORNER_RATIO) -> Image.Image:
    """Tab and search-result icons are shown as-is, so they carry their own rounded corners."""
    scale = 8
    w, h = img.size
    mask = Image.new("L", (w * scale, h * scale), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, w * scale - 1, h * scale - 1], radius=round(min(w, h) * ratio * scale), fill=255)
    out = img.convert("RGBA")
    out.putalpha(Image.composite(out.split()[-1], Image.new("L", out.size, 0), mask.resize(out.size, Image.Resampling.LANCZOS)))
    return out


def save_png(img: Image.Image, path: Path, *, rgb: bool = False) -> None:
    out = img.convert("RGB") if rgb else img
    out.save(path, "PNG", optimize=True)
    print(f"wrote {path.relative_to(ROOT)} {out.size}")


def write_ico(path: Path, images: list[Image.Image]) -> None:
    entries: list[tuple[int, int, int, int]] = []
    blobs: list[bytes] = []
    offset = 6 + 16 * len(images)
    for im in images:
        im = im.convert("RGBA")
        buf = io.BytesIO()
        im.save(buf, format="PNG")
        blob = buf.getvalue()
        w, h = im.size
        entries.append((0 if w >= 256 else w, 0 if h >= 256 else h, len(blob), offset))
        blobs.append(blob)
        offset += len(blob)
    out = bytearray()
    out += struct.pack("<HHH", 0, 1, len(images))
    for w, h, size, off in entries:
        out += struct.pack("<BBBBHHII", w, h, 0, 0, 1, 32, size, off)
    for blob in blobs:
        out += blob
    path.write_bytes(out)
    print(f"wrote {path.relative_to(ROOT)} ({len(images)} sizes, {len(out)} bytes)")


def main() -> None:
    OUT.mkdir(exist_ok=True)
    save_png(rounded(sized_icon(32)), OUT / "favicon-32x32.png")
    save_png(rounded(sized_icon(48)), OUT / "favicon-48x48.png")
    # Home-screen icons get rounded or circular masks; their targets keep the mark inside the safe zone.
    save_png(sized_icon(180), OUT / "apple-touch-icon.png", rgb=True)
    save_png(sized_icon(192), OUT / "icon-192.png", rgb=True)
    save_png(sized_icon(512), OUT / "icon-512.png", rgb=True)
    save_png(rounded(sized_icon(256)), OUT / "favicon.png")
    write_ico(OUT / "favicon.ico", [rounded(sized_icon(16)), rounded(sized_icon(32)), rounded(sized_icon(48))])
    png48 = (OUT / "favicon-48x48.png").read_bytes()
    (OUT / "favicon.svg").write_text(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" role="img" aria-label="Convolve">\n'
        f'  <image href="data:image/png;base64,{base64.b64encode(png48).decode("ascii")}" width="48" height="48"/>\n'
        "</svg>\n"
    )
    print("wrote public/favicon.svg")


if __name__ == "__main__":
    main()
