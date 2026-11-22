"""Walk-through check: render halfway between consecutive photo positions.

The room evaluator's poses push forward from photo 1, which can land inside a shelf. With a
walk-through capture, the midpoint between two consecutive camera positions is a place someone
actually stood, and no photo was taken there, so it is a fair novel view. Each row of walk.png is
photo k | render halfway to photo k+1 | photo k+1. Renders use the full-density SOG.
"""

import json
import math
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageOps

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "rooms"))
import evaluate as rooms  # noqa: E402

ROWS = 6
TILE = (360, 480)


def midpoints(camera, count, n_real=None):
    poses = {int(e["camera_id"]): np.asarray(e["matrix"]) for e in camera["extrinsics"]}
    # Repaired runs append synthetic views after the real photos; only walk between real ones.
    n_real = n_real or len(poses)
    ks = {int(i["camera_id"]): np.asarray(i["matrix"]) for i in camera["intrinsics"]}
    # Camera 0 is the hand-picked first photo; 1..N-1 follow the capture order.
    pairs = [(k, k + 1) for k in range(1, n_real - 1)]
    out = []
    for a, b in pairs:
        pa, pb = poses[a], poses[b]
        forward = pa[:3, 2] + pb[:3, 2]
        if np.linalg.norm(forward) < 0.5:  # the two shots face away from each other
            continue
        forward /= np.linalg.norm(forward)
        up = -(pa[:3, 1] + pb[:3, 1])
        up /= np.linalg.norm(up)
        origin = (pa[:3, 3] + pb[:3, 3]) / 2
        vfov = math.degrees(2 * math.atan(ks[a][1, 2] / ks[a][1, 1]))
        out.append({"a": a, "b": b, "position": origin, "target": origin + forward, "up": up, "vfov": vfov,
                    "step": float(np.linalg.norm(pa[:3, 3] - pb[:3, 3]))})
    if len(out) > count:
        out = [out[round(i * (len(out) - 1) / (count - 1))] for i in range(count)]
    return out


def walk(row, room):
    directory = HERE / row["directory"]
    sog = directory / "room-native.sog"
    setup = json.loads((directory / "render-poses.json").read_text())
    upm = setup["units_per_meter_estimate"]
    near = setup["views"][0]["near"]
    n_real = sum(not p.get("synthetic") for p in room["photos"])
    views = midpoints(json.loads((directory / "camera_params.json").read_text()), ROWS, n_real)
    photos = [HERE / next(p for p in room["photos"] if p["id"] == i)["path"] for i in row["photo_ids"]]
    font = ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial.ttf", 16)
    w, h = TILE
    sheet = Image.new("RGB", (3 * w + 40, len(views) * (h + 30) + 50), "#181a1f")
    draw = ImageDraw.Draw(sheet)
    draw.text((10, 12), f"{row['restaurant']} · {row['n_photos']} photos · {row['resolution']} px · "
                        "photo k | halfway | photo k+1", font=font, fill="white")
    for r, v in enumerate(views):
        path = directory / f"walk-{v['a']:02}-{v['b']:02}.webp"
        if not path.exists():
            csv = lambda vec: ",".join(f"{x:.8g}" for x in vec * rooms.PLY_TO_ENGINE)
            rooms.cli(sog, path, "--camera-pos", csv(v["position"]), "--camera-target", csv(v["target"]),
                      "--camera-up", csv(v["up"]), "--camera-fov", v["vfov"], "--camera-near", near,
                      "--resolution", f"{w}x{h}", "--background", "0.09,0.09,0.09,1")
        y = 50 + r * (h + 30)
        tiles = [Image.open(photos[v["a"]]), Image.open(path), Image.open(photos[v["b"]])]
        for c, tile in enumerate(tiles):
            sheet.paste(ImageOps.fit(tile.convert("RGB"), (w, h)), (10 + c * (w + 10), y + 22))
        draw.text((10, y), f"photos {v['a'] + 1} → {v['b'] + 1}, est. {v['step'] / upm:.1f} m apart",
                  font=font, fill="#d7dae0")
    sheet.save(directory / "walk.png")
    print(directory / "walk.png", flush=True)


if __name__ == "__main__":
    manifest = {r["id"]: r for r in json.loads((HERE / "sources/manifest.json").read_text())}
    only = set(sys.argv[1:])
    for row in json.loads((HERE / "results.json").read_text()):
        name = Path(row["directory"]).name
        if row["status"] == "succeeded" and row["n_photos"] > 3 and (not only or name in only):
            if (HERE / row["directory"] / "room-native.sog").exists():
                walk(row, manifest[row["room_id"]])
