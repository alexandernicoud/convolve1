#!/usr/bin/env python3
"""Regenerate favicons, PWA icons and the Open Graph image from src/assets/convolve-mark.png.

Run from the repo root:
  python3 scripts/generate-brand-assets.py
"""
from __future__ import annotations

import base64
import io
import struct
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
MARK = Image.open(ROOT / "src/assets/convolve-mark.png").convert("RGBA")
OUT = ROOT / "public"
BG = (5, 5, 6, 255)


def square_icon(size: int, pad_ratio: float = 0.18) -> Image.Image:
    canvas = Image.new("RGBA", (size, size), BG)
    pad = int(size * pad_ratio)
    inner = max(1, size - 2 * pad)
    mark = MARK.copy()
    bbox = mark.split()[-1].getbbox()
    if bbox:
        mark = mark.crop(bbox)
    mark.thumbnail((inner, inner), Image.Resampling.LANCZOS)
    canvas.alpha_composite(mark, ((size - mark.width) // 2, (size - mark.height) // 2))
    return canvas


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


def write_og() -> None:
    w, h = 1200, 630
    og = Image.new("RGB", (w, h), (5, 5, 6))
    draw = ImageDraw.Draw(og)
    draw.rectangle([0, 0, w, 2], fill=(166, 236, 200))
    mark = square_icon(220, pad_ratio=0.12).convert("RGBA")
    og.paste(mark, (96, (h - mark.height) // 2), mark)
    try:
        font_brand = ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial Bold.ttf", 92)
        font_sub = ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial.ttf", 34)
    except OSError:
        font_brand = ImageFont.load_default()
        font_sub = font_brand
    brand, sub = "Convolve", "Chart-based neural nets for markets"
    text_x = 96 + mark.width + 48
    bb = draw.textbbox((0, 0), brand, font=font_brand)
    bh = bb[3] - bb[1]
    sb = draw.textbbox((0, 0), sub, font=font_sub)
    sh = sb[3] - sb[1]
    gap = 22
    text_y = (h - (bh + gap + sh)) // 2 - 8
    draw.text((text_x, text_y), brand, font=font_brand, fill=(255, 255, 255))
    draw.text((text_x, text_y + bh + gap), sub, font=font_sub, fill=(180, 180, 185))
    path = OUT / "og-image.png"
    og.save(path, "PNG", optimize=True)
    print(f"wrote {path.relative_to(ROOT)} {og.size}")


def main() -> None:
    OUT.mkdir(exist_ok=True)
    save_png(square_icon(32), OUT / "favicon-32x32.png")
    save_png(square_icon(48), OUT / "favicon-48x48.png")
    save_png(square_icon(180), OUT / "apple-touch-icon.png", rgb=True)
    save_png(square_icon(192), OUT / "icon-192.png", rgb=True)
    save_png(square_icon(512, pad_ratio=0.16), OUT / "icon-512.png", rgb=True)
    save_png(square_icon(256), OUT / "favicon.png")
    write_ico(OUT / "favicon.ico", [square_icon(16, 0.12), square_icon(32), square_icon(48)])
    png48 = (OUT / "favicon-48x48.png").read_bytes()
    (OUT / "favicon.svg").write_text(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" role="img" aria-label="Convolve">\n'
        f'  <image href="data:image/png;base64,{base64.b64encode(png48).decode("ascii")}" width="48" height="48"/>\n'
        "</svg>\n"
    )
    print("wrote public/favicon.svg")
    write_og()


if __name__ == "__main__":
    main()
