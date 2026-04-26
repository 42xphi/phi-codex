#!/usr/bin/env python3

import math
import struct
import sys
import zlib


def _png_chunk(tag: bytes, data: bytes) -> bytes:
    return (
        struct.pack("!I", len(data))
        + tag
        + data
        + struct.pack("!I", zlib.crc32(tag + data) & 0xFFFFFFFF)
    )


def write_png(path: str, width: int, height: int, rgba: bytes) -> None:
    if len(rgba) != width * height * 4:
        raise ValueError("RGBA buffer size mismatch.")

    raw = bytearray()
    row_bytes = width * 4
    for y in range(height):
        raw.append(0)  # filter type 0
        start = y * row_bytes
        raw.extend(rgba[start : start + row_bytes])

    compressed = zlib.compress(bytes(raw), level=9)
    ihdr = struct.pack("!IIBBBBB", width, height, 8, 6, 0, 0, 0)

    png = bytearray()
    png.extend(b"\x89PNG\r\n\x1a\n")
    png.extend(_png_chunk(b"IHDR", ihdr))
    png.extend(_png_chunk(b"IDAT", compressed))
    png.extend(_png_chunk(b"IEND", b""))

    with open(path, "wb") as f:
        f.write(png)


def clamp_u8(x: float) -> int:
    return 0 if x < 0 else 255 if x > 255 else int(x)


def blend_over(dst_rgba: bytearray, idx: int, src: tuple[int, int, int, int]) -> None:
    sr, sg, sb, sa = src
    if sa <= 0:
        return
    if sa >= 255:
        dst_rgba[idx] = sr
        dst_rgba[idx + 1] = sg
        dst_rgba[idx + 2] = sb
        dst_rgba[idx + 3] = 255
        return

    dr = dst_rgba[idx]
    dg = dst_rgba[idx + 1]
    db = dst_rgba[idx + 2]
    da = dst_rgba[idx + 3]
    if da == 0:
        dst_rgba[idx] = sr
        dst_rgba[idx + 1] = sg
        dst_rgba[idx + 2] = sb
        dst_rgba[idx + 3] = sa
        return

    a = sa / 255.0
    dst_rgba[idx] = clamp_u8(sr * a + dr * (1.0 - a))
    dst_rgba[idx + 1] = clamp_u8(sg * a + dg * (1.0 - a))
    dst_rgba[idx + 2] = clamp_u8(sb * a + db * (1.0 - a))
    dst_rgba[idx + 3] = 255


def draw_rect(
    buf: bytearray,
    w: int,
    h: int,
    x0: int,
    y0: int,
    x1: int,
    y1: int,
    color: tuple[int, int, int, int],
) -> None:
    x0 = max(0, min(w, x0))
    x1 = max(0, min(w, x1))
    y0 = max(0, min(h, y0))
    y1 = max(0, min(h, y1))
    if x1 <= x0 or y1 <= y0:
        return

    for y in range(y0, y1):
        row = y * w * 4
        for x in range(x0, x1):
            idx = row + x * 4
            blend_over(buf, idx, color)


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: generate_icon.py <out.png>", file=sys.stderr)
        return 2

    out_path = sys.argv[1]
    w = 1024
    h = 1024

    # Background gradient
    top = (88, 28, 135)
    bot = (147, 51, 234)
    buf = bytearray(w * h * 4)

    cx = (w - 1) / 2.0
    cy = (h - 1) / 2.0
    max_r = math.sqrt(cx * cx + cy * cy)

    for y in range(h):
        t = y / (h - 1)
        base_r = top[0] * (1.0 - t) + bot[0] * t
        base_g = top[1] * (1.0 - t) + bot[1] * t
        base_b = top[2] * (1.0 - t) + bot[2] * t
        for x in range(w):
            dx = x - cx
            dy = y - cy
            r = math.sqrt(dx * dx + dy * dy) / max_r
            glow = max(0.0, 1.0 - r)
            rr = clamp_u8(base_r + glow * 18.0)
            gg = clamp_u8(base_g + glow * 10.0)
            bb = clamp_u8(base_b + glow * 22.0)
            idx = (y * w + x) * 4
            buf[idx] = rr
            buf[idx + 1] = gg
            buf[idx + 2] = bb
            buf[idx + 3] = 255

    # Pi symbol (simple, bold)
    stroke = 110
    top_y0 = 210
    top_y1 = top_y0 + stroke
    stem_y0 = top_y1
    stem_y1 = 860
    left_x0 = 315
    left_x1 = left_x0 + stroke
    right_x1 = 709
    right_x0 = right_x1 - stroke
    top_x0 = 230
    top_x1 = 794

    shadow = (0, 0, 0, 70)
    white = (255, 255, 255, 255)

    # Shadow (offset)
    off = 18
    draw_rect(buf, w, h, top_x0 + off, top_y0 + off, top_x1 + off, top_y1 + off, shadow)
    draw_rect(buf, w, h, left_x0 + off, stem_y0 + off, left_x1 + off, stem_y1 + off, shadow)
    draw_rect(buf, w, h, right_x0 + off, stem_y0 + off, right_x1 + off, stem_y1 + off, shadow)

    # Foreground
    draw_rect(buf, w, h, top_x0, top_y0, top_x1, top_y1, white)
    draw_rect(buf, w, h, left_x0, stem_y0, left_x1, stem_y1, white)
    draw_rect(buf, w, h, right_x0, stem_y0, right_x1, stem_y1, white)

    write_png(out_path, w, h, bytes(buf))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

