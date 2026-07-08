#!/usr/bin/env python3
"""Build agent_grok.png from Ani.png — 64×128 pixel-art spritesheet with real detail.

Downsamples the Desktop reference with palette quantization, then packs the
standard 7×3 office animation grid (down / up / right × walk/type/read).
"""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageEnhance, ImageOps

ROOT = Path(__file__).resolve().parent.parent
SRC = Path.home() / "Desktop" / "Ani.png"
OUT = ROOT / "public" / "office" / "characters" / "agent_grok.png"

FW, FH, COLS, ROWS = 64, 128, 7, 3
COLORS = 48


def remove_bg(im: Image.Image) -> Image.Image:
    im = im.convert("RGBA")
    px = im.load()
    w, h = im.size
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if r > 235 and g > 235 and b > 235:
                px[x, y] = (0, 0, 0, 0)
            elif r < 50 and g < 45 and b < 60:
                px[x, y] = (0, 0, 0, 0)
    return im


def crop_character(im: Image.Image) -> Image.Image:
    bbox = im.getbbox()
    return im.crop(bbox) if bbox else im


def to_pixel_frame(im: Image.Image, mirror: bool = False) -> Image.Image:
    src = ImageOps.mirror(im) if mirror else im
    src = ImageEnhance.Contrast(src).enhance(1.18)
    src = ImageEnhance.Color(src).enhance(1.12)
    src = ImageEnhance.Sharpness(src).enhance(1.35)
    iw, ih = src.size
    scale = min(FW / iw, FH / ih)
    nw, nh = max(1, int(iw * scale)), max(1, int(ih * scale))
    # smooth downsample then hard nearest-neighbor for crisp pixel blocks
    smooth = src.resize((nw * 2, nh * 2), Image.Resampling.LANCZOS)
    crisp = smooth.resize((nw, nh), Image.Resampling.NEAREST)
    canvas = Image.new("RGBA", (FW, FH), (0, 0, 0, 0))
    canvas.paste(crisp, ((FW - nw) // 2, FH - nh), crisp)
    alpha = canvas.split()[3]
    rgb = canvas.convert("RGB")
    q = rgb.quantize(colors=COLORS, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
    out = q.convert("RGBA")
    out.putalpha(alpha)
    return out


def dominant_hair_color(frame: Image.Image) -> tuple[int, int, int, int]:
    px = frame.load()
    counts: dict[tuple[int, int, int], int] = {}
    for y in range(0, FH // 3):
        for x in range(FW):
            r, g, b, a = px[x, y]
            if a < 128:
                continue
            if g > r and b > r:
                continue
            key = (r // 16, g // 16, b // 16)
            counts[key] = counts.get(key, 0) + 1
    if not counts:
        return (232, 200, 72, 255)
    best = max(counts, key=counts.get)
    return (best[0] * 16 + 8, best[1] * 16 + 8, best[2] * 16 + 8, 255)


def make_back(front: Image.Image) -> Image.Image:
    back = front.copy()
    px = back.load()
    hair = dominant_hair_color(front)
    for y in range(18, 52):
        for x in range(14, FW - 14):
            r, g, b, a = px[x, y]
            if a < 40:
                continue
            if r > 180 and g > 140 and b > 120:
                px[x, y] = hair
    return back


def shift_region(frame: Image.Image, y0: int, dy: int, dx: int) -> Image.Image:
    out = frame.copy()
    px = out.load()
    w, h = out.size
    chunk = Image.new("RGBA", (w, h - y0), (0, 0, 0, 0))
    cpx = chunk.load()
    for y in range(y0, h):
        for x in range(w):
            cpx[x, y - y0] = px[x, y]
    chunk_px = chunk.load()
    for y in range(y0, h):
        for x in range(w):
            px[x, y] = (0, 0, 0, 0)
    for y in range(y0, h):
        for x in range(w):
            sx = x - dx
            if 0 <= sx < w:
                px[x, y] = chunk_px[sx, y - y0]
    return out


def add_typing_arms(frame: Image.Image, raised: bool) -> Image.Image:
    out = frame.copy()
    px = out.load()
    skin = (248, 208, 192, 255)
    y = 44 if raised else 48
    for x in range(6, 14):
        px[x, y] = skin
        px[x, y + 1] = skin
    for x in range(FW - 14, FW - 6):
        px[x, y] = skin
        px[x, y + 1] = skin
    return out


def add_reading(frame: Image.Image, glance: bool) -> Image.Image:
    out = frame.copy()
    px = out.load()
    paper = (237, 233, 224, 255)
    for y in range(58, 74):
        for x in range(24, 40):
            px[x, y] = paper
    if glance:
        for x in range(26, 38):
            px[x, 36] = (0, 0, 0, 0)
        for x in range(28, 36):
            px[x, 40] = (30, 80, 200, 255)
    return out


def build_sheet(front: Image.Image, side: Image.Image, back: Image.Image) -> Image.Image:
    sheet = Image.new("RGBA", (FW * COLS, FH * ROWS), (0, 0, 0, 0))
    poses = [
        ("walk", 0, lambda f: shift_region(f, 88, 0, -2)),
        ("walk", 1, lambda f: f),
        ("walk", 2, lambda f: shift_region(f, 88, 0, 2)),
        ("type", 0, lambda f: add_typing_arms(f, False)),
        ("type", 1, lambda f: add_typing_arms(f, True)),
        ("read", 0, lambda f: add_reading(f, False)),
        ("read", 1, lambda f: add_reading(f, True)),
    ]
    dirs = [front, back, side]
    for dir_idx, base in enumerate(dirs):
        for col, (_kind, _fi, fn) in enumerate(poses):
            frame = fn(base)
            sheet.paste(frame, (col * FW, dir_idx * FH), frame)
    return sheet


def main() -> None:
    if not SRC.exists():
        raise SystemExit(f"missing reference: {SRC}")
    raw = Image.open(SRC)
    cut = crop_character(remove_bg(raw))
    # front + side crop from reference
    w, h = cut.size
    side_crop = cut.crop((0, 0, int(w * 0.52), h))
    front = to_pixel_frame(cut)
    side = to_pixel_frame(side_crop, mirror=False)
    back = make_back(front)
    sheet = build_sheet(front, side, back)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(OUT)
    print(f"wrote {OUT.name} ({sheet.width}×{sheet.height}) from {SRC.name}")


if __name__ == "__main__":
    main()