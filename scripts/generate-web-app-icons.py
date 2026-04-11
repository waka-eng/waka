#!/usr/bin/env python3

from __future__ import annotations

import argparse
import math
import os
import struct
import zlib
from dataclasses import dataclass
from pathlib import Path


DEFAULT_OUTPUT_DIRECTORY = Path("apps/web/public/icons")


@dataclass(frozen=True)
class IconSpec:
    file_name: str
    size: int
    variant: str


ICON_SPECS: tuple[IconSpec, ...] = (
    IconSpec("icon-16.png", 16, "standard"),
    IconSpec("icon-32.png", 32, "standard"),
    IconSpec("apple-touch-icon.png", 180, "standard"),
    IconSpec("apple-touch-icon-167.png", 167, "standard"),
    IconSpec("apple-touch-icon-152.png", 152, "standard"),
    IconSpec("apple-touch-icon-120.png", 120, "standard"),
    IconSpec("icon-192.png", 192, "standard"),
    IconSpec("icon-512.png", 512, "standard"),
    IconSpec("icon-maskable-512.png", 512, "maskable"),
)


BACKGROUND_TOP = (26.0, 19.0, 14.0)
BACKGROUND_BOTTOM = (12.0, 10.0, 9.0)
BACKGROUND_GLOW = (91.0, 45.0, 18.0)
FRAME_COLOR = (120.0, 92.0, 67.0)
DISK_LIGHT = (251.0, 191.0, 36.0)
DISK_DARK = (249.0, 115.0, 22.0)
DISK_RING = (124.0, 45.0, 18.0)
GLYPH_COLOR = (255.0, 250.0, 241.0)
GLYPH_SHADOW = (57.0, 23.0, 10.0)


def clamp(value: float, minimum: float = 0.0, maximum: float = 1.0) -> float:
    return max(minimum, min(maximum, value))


def smoothstep(edge0: float, edge1: float, value: float) -> float:
    if edge0 == edge1:
        return 1.0 if value >= edge1 else 0.0

    normalized = clamp((value - edge0) / (edge1 - edge0))
    return normalized * normalized * (3.0 - (2.0 * normalized))


def mix(left: tuple[float, float, float], right: tuple[float, float, float], factor: float) -> tuple[float, float, float]:
    return tuple(
        (left[index] * (1.0 - factor)) + (right[index] * factor) for index in range(3)
    )


def alpha_blend(
    base: tuple[float, float, float],
    overlay: tuple[float, float, float],
    alpha: float,
) -> tuple[float, float, float]:
    return tuple(
        (base[index] * (1.0 - alpha)) + (overlay[index] * alpha)
        for index in range(3)
    )


def vector_length(x: float, y: float) -> float:
    return math.sqrt((x * x) + (y * y))


def distance_to_segment(
    point_x: float,
    point_y: float,
    start_x: float,
    start_y: float,
    end_x: float,
    end_y: float,
) -> float:
    segment_x = end_x - start_x
    segment_y = end_y - start_y
    segment_length_squared = (segment_x * segment_x) + (segment_y * segment_y)

    if segment_length_squared == 0.0:
        return vector_length(point_x - start_x, point_y - start_y)

    projection = (
        ((point_x - start_x) * segment_x) + ((point_y - start_y) * segment_y)
    ) / segment_length_squared
    projection = clamp(projection)

    nearest_x = start_x + (projection * segment_x)
    nearest_y = start_y + (projection * segment_y)
    return vector_length(point_x - nearest_x, point_y - nearest_y)


def encode_png(width: int, height: int, rows: list[bytes]) -> bytes:
    header = struct.pack("!2I5B", width, height, 8, 6, 0, 0, 0)
    image_data = b"".join(b"\x00" + row for row in rows)
    compressed = zlib.compress(image_data, level=9)

    def chunk(chunk_type: bytes, payload: bytes) -> bytes:
        checksum = zlib.crc32(chunk_type)
        checksum = zlib.crc32(payload, checksum) & 0xFFFFFFFF
        return struct.pack("!I", len(payload)) + chunk_type + payload + struct.pack("!I", checksum)

    signature = b"\x89PNG\r\n\x1a\n"
    return signature + chunk(b"IHDR", header) + chunk(b"IDAT", compressed) + chunk(b"IEND", b"")


def disk_configuration(variant: str) -> tuple[float, float]:
    if variant == "maskable":
        return 0.54, 0.255

    return 0.54, 0.282


def render_pixel(
    size: int,
    variant: str,
    pixel_x: int,
    pixel_y: int,
) -> tuple[int, int, int, int]:
    x = (pixel_x + 0.5) / size
    y = (pixel_y + 0.5) / size

    background_mix = clamp((0.38 * x) + (0.92 * y))
    color = mix(BACKGROUND_TOP, BACKGROUND_BOTTOM, background_mix)

    glow_distance = vector_length(x - 0.3, y - 0.2)
    glow_alpha = clamp(1.0 - (glow_distance / 0.55)) ** 2 * 0.34
    color = alpha_blend(color, BACKGROUND_GLOW, glow_alpha)

    vignette_distance = vector_length(x - 0.5, y - 0.5)
    vignette_alpha = smoothstep(0.38, 0.84, vignette_distance) * 0.28
    color = alpha_blend(color, BACKGROUND_BOTTOM, vignette_alpha)

    if variant == "standard":
        edge = min(x, y, 1.0 - x, 1.0 - y)
        outer_frame = 1.0 - smoothstep(0.018, 0.048, edge)
        inner_cutout = 1.0 - smoothstep(0.048, 0.078, edge)
        frame_alpha = clamp(outer_frame - inner_cutout) * 0.38

        if frame_alpha > 0.0:
            color = alpha_blend(color, FRAME_COLOR, frame_alpha)

    disk_center_y, disk_radius = disk_configuration(variant)
    disk_distance = vector_length(x - 0.5, y - disk_center_y)
    disk_alpha = 1.0 - smoothstep(disk_radius - 0.012, disk_radius + 0.012, disk_distance)

    if disk_alpha > 0.0:
        directional_mix = clamp(
            0.5
            + ((x - 0.5) * 0.9 / disk_radius)
            + ((y - disk_center_y) * 1.3 / disk_radius),
        )
        disk_color = mix(DISK_LIGHT, DISK_DARK, directional_mix)
        highlight_alpha = clamp(1.0 - (vector_length(x - 0.42, y - (disk_center_y - 0.1)) / 0.3)) * 0.32
        disk_color = alpha_blend(disk_color, GLYPH_COLOR, highlight_alpha)
        color = alpha_blend(color, disk_color, disk_alpha)

        disk_ring_alpha = clamp(
            smoothstep(disk_radius - 0.04, disk_radius - 0.012, disk_distance)
            - smoothstep(disk_radius - 0.012, disk_radius + 0.014, disk_distance),
        ) * 0.42

        if disk_ring_alpha > 0.0:
            color = alpha_blend(color, DISK_RING, disk_ring_alpha)

    stroke_width = 0.05 if size >= 64 else 0.058
    glyph_points = (
        (0.32, 0.35),
        (0.405, 0.69),
        (0.5, 0.475),
        (0.595, 0.69),
        (0.68, 0.35),
    )

    shadow_distance = min(
        distance_to_segment(
            x,
            y,
            glyph_points[index][0] + 0.012,
            glyph_points[index][1] + 0.018,
            glyph_points[index + 1][0] + 0.012,
            glyph_points[index + 1][1] + 0.018,
        )
        for index in range(len(glyph_points) - 1)
    )
    shadow_alpha = 1.0 - smoothstep(stroke_width, stroke_width + 0.022, shadow_distance)

    if shadow_alpha > 0.0:
        color = alpha_blend(color, GLYPH_SHADOW, shadow_alpha * 0.48)

    glyph_distance = min(
        distance_to_segment(
            x,
            y,
            glyph_points[index][0],
            glyph_points[index][1],
            glyph_points[index + 1][0],
            glyph_points[index + 1][1],
        )
        for index in range(len(glyph_points) - 1)
    )
    glyph_alpha = 1.0 - smoothstep(stroke_width, stroke_width + 0.02, glyph_distance)

    if glyph_alpha > 0.0:
        color = alpha_blend(color, GLYPH_COLOR, glyph_alpha)

    spark_distance = vector_length(x - 0.73, y - 0.265)
    spark_alpha = 1.0 - smoothstep(0.032, 0.058, spark_distance)

    if spark_alpha > 0.0:
        spark_color = alpha_blend(DISK_LIGHT, GLYPH_COLOR, 0.4)
        color = alpha_blend(color, spark_color, spark_alpha * 0.9)

    return (
        round(clamp(color[0], 0.0, 255.0)),
        round(clamp(color[1], 0.0, 255.0)),
        round(clamp(color[2], 0.0, 255.0)),
        255,
    )


def render_icon(size: int, variant: str) -> bytes:
    rows: list[bytes] = []

    for pixel_y in range(size):
        row = bytearray()

        for pixel_x in range(size):
            red, green, blue, alpha = render_pixel(size, variant, pixel_x, pixel_y)
            row.extend((red, green, blue, alpha))

        rows.append(bytes(row))

    return encode_png(size, size, rows)


def write_icon(icon_spec: IconSpec, output_directory: Path) -> None:
    payload = render_icon(icon_spec.size, icon_spec.variant)
    destination_path = output_directory / icon_spec.file_name
    destination_path.write_bytes(payload)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Generate the Waka web app icon set.",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=DEFAULT_OUTPUT_DIRECTORY,
        help="Directory where the generated icons should be written.",
    )
    return parser.parse_args()


def main() -> None:
    arguments = parse_args()
    output_directory = arguments.output_dir

    os.makedirs(output_directory, exist_ok=True)

    for icon_spec in ICON_SPECS:
        write_icon(icon_spec, output_directory)
        print(f"generated {output_directory / icon_spec.file_name}")


if __name__ == "__main__":
    main()
