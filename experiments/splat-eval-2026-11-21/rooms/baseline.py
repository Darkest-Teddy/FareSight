"""Single-photo Depth Anything V2 Small mesh and matched local comparison views."""

import argparse
import json
import math
import struct

import numpy as np
from numba import njit
from PIL import Image

from evaluate import PLY_TO_ENGINE, make_sheet, unit
from run import ROOT, write_json

BASE = ROOT / "outputs/baseline"
MODEL = "depth-anything/Depth-Anything-V2-Small-hf"


def predict_depth(rooms):
    import torch
    from transformers import AutoImageProcessor, AutoModelForDepthEstimation

    remaining = [r for r in rooms if not (BASE / r["id"] / "relative-depth.npy").exists()]
    if not remaining:
        return
    processor = AutoImageProcessor.from_pretrained(MODEL, use_fast=False)
    device = "mps" if torch.backends.mps.is_available() else "cpu"
    model = AutoModelForDepthEstimation.from_pretrained(MODEL).to(device).eval()
    for room in remaining:
        directory = BASE / room["id"]
        directory.mkdir(parents=True, exist_ok=True)
        with Image.open(ROOT / room["photos"][0]["path"]) as photo:
            inputs = processor(images=photo.convert("RGB"), return_tensors="pt").to(device)
        with torch.inference_mode():
            depth = model(**inputs).predicted_depth.squeeze().float().cpu().numpy()
        assert depth.ndim == 2 and np.isfinite(depth).all() and np.ptp(depth) > .001
        np.save(directory / "relative-depth.npy", depth)
        print(f"{room['id']}: {MODEL} predicted {depth.shape} on {device}", flush=True)


def mesh(depth, vfov, height):
    w, h = 320, 240
    depth = np.asarray(Image.fromarray(depth).resize((w, h), Image.Resampling.BILINEAR))
    low, high = np.percentile(depth, (5, 95))
    inverse_depth = np.clip((depth - low) / (high - low), 0, 1)
    z = 1 / (.14 + .90 * inverse_depth)
    f = h / (2 * math.tan(math.radians(vfov) / 2))
    y, x = np.indices((h, w), dtype=np.float32)
    yn = (y + .5 - h / 2) / f
    xn = (x + .5 - w / 2) / f
    below = (y > h * .80) & (np.abs(x + .5 - w / 2) < w * .18)
    scale = height / np.median((yn * z)[below])
    z = np.asarray(z * scale, dtype=np.float32)
    xyz = np.stack((xn * z, yn * z, z), axis=-1).reshape(-1, 3)
    uv = np.stack(((x + .5) / w, (y + .5) / h), axis=-1).reshape(-1, 2)

    corners = np.arange(w * h, dtype=np.uint32).reshape(h, w)
    top_left = corners[:-1, :-1].ravel()
    faces = np.concatenate((
        np.stack((top_left, top_left + w, top_left + 1), axis=-1),
        np.stack((top_left + 1, top_left + w, top_left + w + 1), axis=-1),
    ))
    face_z = z.ravel()[faces]
    coherent = np.ptp(face_z, axis=1) < .12 * face_z.min(axis=1)
    return xyz, uv, faces[coherent]


def write_glb(path, xyz, uv, faces, jpeg):
    vertices = (xyz * np.array([1, -1, -1], dtype=np.float32)).astype("<f4")
    pieces = vertices.tobytes(), uv.astype("<f4").tobytes(), faces.astype("<u4").tobytes(), jpeg
    views = []
    binary = b""
    for part, target in zip(pieces, (34962, 34962, 34963, None)):
        view = {"buffer": 0, "byteOffset": len(binary), "byteLength": len(part)}
        if target is not None:
            view["target"] = target
        views.append(view)
        binary += part + b"\x00" * (-len(part) % 4)
    info = {
        "asset": {"version": "2.0", "generator": "FareSight depth baseline"},
        "scene": 0, "scenes": [{"nodes": [0]}], "nodes": [{"mesh": 0}],
        "meshes": [{"primitives": [{"attributes": {"POSITION": 0, "TEXCOORD_0": 1},
                                     "indices": 2, "material": 0}]}],
        "buffers": [{"byteLength": len(binary)}], "bufferViews": views,
        "accessors": [
            {"bufferView": 0, "componentType": 5126, "count": len(xyz), "type": "VEC3",
             "min": vertices.min(axis=0).tolist(), "max": vertices.max(axis=0).tolist()},
            {"bufferView": 1, "componentType": 5126, "count": len(uv), "type": "VEC2"},
            {"bufferView": 2, "componentType": 5125, "count": faces.size, "type": "SCALAR"},
        ],
        "images": [{"bufferView": 3, "mimeType": "image/jpeg"}], "textures": [{"source": 0}],
        "materials": [{"doubleSided": True, "pbrMetallicRoughness": {"baseColorTexture": {"index": 0}},
                       "extensions": {"KHR_materials_unlit": {}}}],
        "extensionsUsed": ["KHR_materials_unlit"],
    }
    header = json.dumps(info, separators=(",", ":")).encode()
    header += b" " * (-len(header) % 4)
    path.write_bytes(
        struct.pack("<4sII", b"glTF", 2, 28 + len(header) + len(binary))
        + struct.pack("<I4s", len(header), b"JSON") + header
        + struct.pack("<I4s", len(binary), b"BIN\x00") + binary
    )


@njit
def rasterize(screen, uv, faces, texture, width, height):
    rgb = np.full((height, width, 3), 23, np.uint8)
    zbuffer = np.full((height, width), np.inf, np.float32)
    th, tw = texture.shape[:2]
    for face in faces:
        i, j, k = face
        ax, ay, az = screen[i]
        bx, by, bz = screen[j]
        cx, cy, cz = screen[k]
        if min(az, bz, cz) <= .025:
            continue
        det = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy)
        if abs(det) < 1e-7:
            continue
        for y in range(max(0, math.floor(min(ay, by, cy))), min(height, math.ceil(max(ay, by, cy)))):
            for x in range(max(0, math.floor(min(ax, bx, cx))), min(width, math.ceil(max(ax, bx, cx)))):
                px, py = x + .5 - cx, y + .5 - cy
                a = ((by - cy) * px + (cx - bx) * py) / det
                b = ((cy - ay) * px + (ax - cx) * py) / det
                c = 1 - a - b
                if min(a, b, c) < -1e-6:
                    continue
                a, b, c = a / az, b / bz, c / cz
                z = 1 / (a + b + c)
                if z >= zbuffer[y, x]:
                    continue
                sx = (a * uv[i, 0] + b * uv[j, 0] + c * uv[k, 0]) * z * tw
                sy = (a * uv[i, 1] + b * uv[j, 1] + c * uv[k, 1]) * z * th
                ix = min(tw - 1, max(0, int(sx)))
                iy = min(th - 1, max(0, int(sy)))
                rgb[y, x] = texture[iy, ix]
                zbuffer[y, x] = z
    return rgb


def render_mesh(directory, geometry, texture, pose, setup):
    xyz, uv, faces = geometry
    rotation = pose[:3, :3]
    origin = pose[:3, 3]
    units = setup["units_per_meter_estimate"]

    def from_world(point):
        return (np.asarray(point) * PLY_TO_ENGINE - origin) @ rotation / units

    paths = []
    for view in setup["views"]:
        pos = from_world(view["position"])
        forward = unit(from_world(view["target"]) - pos)
        up = (np.asarray(view["up"]) * PLY_TO_ENGINE) @ rotation
        right = unit(np.cross(forward, up))
        down = unit(np.cross(forward, right))
        points = (xyz - pos) @ np.column_stack((right, down, forward))
        width, height = view["pixels"]
        f = height / (2 * math.tan(math.radians(view["vertical_fov_deg"]) / 2))
        points[:, :2] = points[:, :2] * f / np.maximum(points[:, 2:3], .025) + [width / 2, height / 2]
        rgb = rasterize(points, uv, faces, texture, width, height)
        if view["id"] == "photo-1":
            assert np.std(rgb, axis=(0, 1)).max() > 5
        path = directory / f"{view['id']}.png"
        Image.fromarray(rgb).save(path)
        paths.append(path)
    return paths


def finish(rooms):
    for room in rooms:
        reference = ROOT / f"outputs/{room['id']}-2p-518"
        setup = json.loads((reference / "render-poses.json").read_text())
        cameras = json.loads((reference / "camera_params.json").read_text())["extrinsics"]
        camera_1 = sorted(cameras, key=lambda item: str(item["camera_id"]))[0]
        pose = np.asarray(camera_1["matrix"])
        directory = BASE / room["id"]
        depth = np.load(directory / "relative-depth.npy")
        geometry = mesh(depth, setup["views"][0]["vertical_fov_deg"], room["reference_height_m_estimate"])
        photo = ROOT / room["photos"][0]["path"]
        glb = directory / "room.glb"
        write_glb(glb, *geometry, photo.read_bytes())
        with Image.open(photo) as image:
            texture = np.asarray(image.convert("RGB"))
        paths = render_mesh(directory, geometry, texture, pose, setup)
        sheet = directory / "contact-sheet.png"
        make_sheet(sheet, f"{room['restaurant']} · single-photo depth mesh", room["photos"][:1], setup, paths)
        write_json(directory / "summary.json", {
            "model": MODEL, "source_photo": room["photos"][0]["path"],
            "render_pose_source": str((reference / "render-poses.json").relative_to(ROOT)),
            "vertices": len(geometry[0]), "triangles": len(geometry[2]), "glb_bytes": glb.stat().st_size,
            "glb": str(glb.relative_to(ROOT)), "contact_sheet": str(sheet.relative_to(ROOT)),
        })
        print(f"{room['id']}: {len(geometry[2]):,} triangles, {glb.stat().st_size:,} GLB bytes", flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--depth-only", action="store_true")
    args = parser.parse_args()
    rooms = json.loads((ROOT / "sources/manifest.json").read_text())
    predict_depth(rooms)
    if not args.depth_only:
        finish(rooms)
