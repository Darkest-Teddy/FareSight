"""Measure each downloaded PLY and render the 100k SOG from its camera poses."""

import argparse
import json
import math
import os
import subprocess
import zipfile
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageOps

from run import ROOT, RESULTS, write_json

CLI = "@playcanvas/splat-transform@3.12.0"
PLY_TO_ENGINE = np.array([-1, -1, 1])
ROOM_HEIGHT_AT_PHOTO_1_M = 1.55
SHEET_FONTS = (Path("/System/Library/Fonts/Supplemental/Arial.ttf"),
               Path("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"))


def read_ply(path):
    with path.open("rb") as file:
        assert file.readline().strip() == b"ply"
        assert file.readline().strip() == b"format binary_little_endian 1.0"
        fields = []
        count = None
        vertices = False
        for i, raw in enumerate(file):
            assert i < 512, "Unexpectedly long PLY header"
            parts = raw.decode("ascii").split()
            if not parts:
                continue
            if parts[0] == "end_header":
                break
            if parts[0] == "element":
                vertices = parts[1] == "vertex"
                if vertices:
                    assert count is None
                    count = int(parts[2])
            if parts[0] == "property" and vertices:
                data_type = {"float": "<f4", "float32": "<f4", "double": "<f8"}[parts[1]]
                fields.append((parts[2], data_type))
        offset = file.tell()
    dtype = np.dtype(fields)
    assert count and offset + count * dtype.itemsize <= path.stat().st_size, "Truncated PLY"
    return np.memmap(path, dtype=dtype, mode="r", offset=offset, shape=(count,))


def columns(vertices, names):
    return np.column_stack([vertices[name] for name in names])


def quantiles(values):
    return dict(zip(("min", "p05", "p50", "p95", "max"), np.quantile(values, (0, .05, .5, .95, 1), axis=0).tolist()))


def measure(path):
    vertices = read_ply(path)
    xyz = columns(vertices, "xyz")
    opacity = vertices["opacity"].astype(np.float64)
    scale = np.exp(columns(vertices, ("scale_0", "scale_1", "scale_2")).astype(np.float64))
    assert np.isfinite(xyz).all() and np.isfinite(opacity).all() and np.isfinite(scale).all()
    stats = {
        "raw_gaussians": len(vertices), "raw_ply_bytes": path.stat().st_size,
        "bounds_raw_model_units": {"min": xyz.min(axis=0).tolist(), "max": xyz.max(axis=0).tolist()},
        "opacity_logit": quantiles(opacity),
        "opacity_linear": quantiles(1 / (1 + np.exp(-np.clip(opacity, -700, 700)))),
        "scale_sigma_xyz_model_units": quantiles(scale),
    }
    return stats, xyz


def cli(*args):
    env = dict(os.environ, npm_config_cache=str(ROOT / "outputs/npm-cache"))
    subprocess.run(["npx", "-y", CLI, *map(str, args)], cwd=ROOT, env=env, check=True)


def compress(ply, count, directory, target):
    decimated = directory / f"decimated-{target}.ply"
    sog = directory / f"room-{target}.sog"
    if not sog.exists():
        if count > target and not decimated.exists():
            cli("-g", "cpu", ply, "--decimate", target, decimated)
        cli("-g", "cpu", decimated if count > target else ply, sog)
    with zipfile.ZipFile(sog) as archive:
        meta = json.loads(archive.read("meta.json"))
    assert 0 < meta["count"] <= target
    return sog, {"gaussians": meta["count"], "bytes": sog.stat().st_size}


def unit(vector):
    return vector / np.linalg.norm(vector)


def choose_views(camera, points, n_photos, reference_height):
    poses = {str(v["camera_id"]): np.asarray(v["matrix"]) for v in camera["extrinsics"]}
    intrinsics = {str(v["camera_id"]): np.asarray(v["matrix"]) for v in camera["intrinsics"]}
    if "0" in poses:
        first = "0"
    else:
        first = sorted(poses)[0]
    assert len(poses) == n_photos and first in intrinsics
    pose, k = poses[first], intrinsics[first]
    assert pose.shape == (4, 4) and k.shape == (3, 3)
    origin = pose[:3, 3]
    right, down, forward = (unit(axis) for axis in pose[:3, :3].T)
    up = -down
    points_camera = (points[::max(1, len(points) // 100_000)] - origin) @ np.stack([right, down, forward]).T
    x, y, z = points_camera.T
    visible = (z > 1e-5) & (np.abs(x) < z * k[0, 2] / k[0, 0]) & (np.abs(y) < z * k[1, 2] / k[1, 1])
    assert visible.sum() > 100, "Photo 1 pose has too few visible Gaussian centers"
    centre = visible & (np.abs(x) < z * .28) & (np.abs(y) < z * .23)
    room_depth = np.median(z[centre] if centre.sum() > 100 else z[visible]).item()

    # Camera pitch and scene scale are estimates until a physical reference is available.
    lower_half = visible & (y > z * .18) & (z < room_depth * .85)
    assumed_eye = np.median(y[lower_half]).item() if lower_half.sum() > 100 else room_depth * .25
    units_per_m = np.clip(assumed_eye, room_depth * .08, room_depth * .45) / reference_height
    progress = min(1.5 * units_per_m, room_depth * .28)
    look = origin + forward * room_depth * .75
    first_vfov = math.degrees(2 * math.atan(k[1, 2] / k[1, 1]))
    width = round(600 * k[0, 2] / k[1, 2])
    standing_offset = (1.55 - reference_height) * up
    seated_offset = (1.20 - reference_height) * up
    views = [
        ("photo-1", "Photo 1 pose", origin, origin + forward, first_vfov, (width, 600), None),
        ("entry-standing", "Near photo 1 · standing", origin + units_per_m * (.25 * right + standing_offset), look, 62, (800, 600), 1.55),
        ("entry-seated", "Near photo 1 · seated", origin + units_per_m * (-.22 * right + seated_offset), look, 62, (800, 600), 1.20),
        ("inside-standing", "Toward centre · standing", origin + progress * forward + units_per_m * standing_offset, look, 62, (800, 600), 1.55),
        ("inside-seated", "Toward centre · seated", origin + progress * forward + units_per_m * (.35 * right + seated_offset), look, 62, (800, 600), 1.20),
    ]

    def coords(vector):
        return (vector * PLY_TO_ENGINE).tolist()

    return {
        "pose_source": f"predicted input camera {first}, OpenCV camera-to-world",
        "units_per_meter_estimate": units_per_m.item(),
        "reference_height_m_estimate": reference_height,
        "pose_note": "Centre approximated along photo 1 forward axis. Heights and movement in metres are estimates based on lower-image geometry and assumed photo 1 height.",
        "views": [{
            "id": key, "label": label, "position": coords(pos), "target": coords(target), "up": coords(up),
            "vertical_fov_deg": vfov, "pixels": list(size), "height_m_estimate": height,
            "translation_from_photo_1_model_units": np.linalg.norm(pos - origin).item(),
            "translation_from_photo_1_m_estimate": (np.linalg.norm(pos - origin) / units_per_m).item(),
            "near": max(.0001, room_depth * .004),
        } for key, label, pos, target, vfov, size, height in views],
    }


def render(sog, directory, setup):
    def csv(values):
        return ",".join(f"{v:.8g}" for v in values)

    paths = []
    for view in setup["views"]:
        path = directory / f"{view['id']}.webp"
        if not path.exists():
            cli(sog, path, "--camera-pos", csv(view["position"]), "--camera-target", csv(view["target"]),
                "--camera-up", csv(view["up"]), "--camera-fov", view["vertical_fov_deg"],
                "--camera-near", view["near"], "--resolution", "x".join(map(str, view["pixels"])),
                "--background", "0.09,0.09,0.09,1")
        with Image.open(path) as image:
            assert list(image.size) == view["pixels"]
            if image.convert("RGB").getbbox() is None:
                print(f"Warning: {path.name} rendered entirely black", flush=True)
        paths.append(path)
    return paths


def make_sheet(path, title, photos, setup, renders):
    gap, w, h = 15, 430, 336
    image = Image.new("RGB", (3 * w + 4 * gap, 3 * h + 85), "#181a1f")
    draw = ImageDraw.Draw(image)
    family = next((path for path in SHEET_FONTS if path.exists()), None)
    font = ImageFont.truetype(str(family), 17) if family else ImageFont.load_default(size=17)
    credit_font = ImageFont.truetype(str(family), 15) if family else ImageFont.load_default(size=15)
    title_font = ImageFont.truetype(str(family), 24) if family else ImageFont.load_default(size=24)
    draw.text((gap, 9), title, font=title_font, fill="white")
    for i, photo in enumerate(photos):
        with Image.open(ROOT / photo["path"]) as source:
            panel = ImageOps.contain(source, (w, h - 39))
        x = gap + i * (w + gap)
        image.paste(panel, (x + (w - panel.width) // 2, 65))
        author = photo["author"].split("\n")[0]
        draw.text((x, 42), f'Input {i + 1} · {author} · {photo["license"]}', font=credit_font, fill="#d7dae0")
    for i, (view, render_path) in enumerate(zip(setup["views"], renders)):
        x = gap + i % 3 * (w + gap)
        y = 55 + (1 + i // 3) * h
        with Image.open(render_path) as render_image:
            panel = ImageOps.contain(render_image, (w, h - 39))
        image.paste(panel, (x + (w - panel.width) // 2, y + 24))
        distance = view["translation_from_photo_1_m_estimate"]
        label = view["label"] + (f" · est. {distance:.2f} m from photo 1" if i else "")
        draw.text((x, y), label, font=font, fill="#d7dae0")
    image.save(path)


def evaluate(row, room, *, with_250k=False):
    directory = ROOT / row["directory"]
    paths = row["output_paths"]
    ply = ROOT / paths["raw_ply"]
    stats, xyz = measure(ply)
    sog, stats["sog_100k"] = compress(ply, stats["raw_gaussians"], directory, 100_000)
    paths["sog_100k"] = str(sog.relative_to(ROOT))
    if with_250k and stats["raw_gaussians"] > 100_000:
        sog250, stats["sog_250k"] = compress(ply, stats["raw_gaussians"], directory, 250_000)
        paths["sog_250k"] = str(sog250.relative_to(ROOT))
    row["stats"] = stats
    row["quest_frame_time_ms"] = None
    camera = json.loads((ROOT / paths["camera_params"]).read_text())
    setup = choose_views(camera, xyz, row["n_photos"], room.get("reference_height_m_estimate", ROOM_HEIGHT_AT_PHOTO_1_M))
    write_json(directory / "render-poses.json", setup)
    renders = render(sog, directory, setup)
    sheet = directory / "contact-sheet.png"
    make_sheet(sheet, f"{row['restaurant']} · {row['n_photos']} photos · {row['resolution']} px",
               room["photos"][:row["n_photos"]], setup, renders)
    paths.update({
        "render_poses": str((directory / "render-poses.json").relative_to(ROOT)),
        "renders": [str(p.relative_to(ROOT)) for p in renders],
        "contact_sheet": str(sheet.relative_to(ROOT)),
    })
    print(f"{row['directory']}: {stats['raw_gaussians']:,} raw, {stats['sog_100k']}, {sheet}", flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--with-250k", action="store_true")
    args = parser.parse_args()
    rooms = {r["id"]: r for r in json.loads((ROOT / "sources/manifest.json").read_text())}
    rows = json.loads(RESULTS.read_text())
    for row in rows:
        if row["status"] == "succeeded" and "raw_ply" in row["output_paths"]:
            evaluate(row, rooms[row["room_id"]], with_250k=args.with_250k)
            write_json(RESULTS, rows)
