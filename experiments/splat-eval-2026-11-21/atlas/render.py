"""Render Atlas splats with SplatTransform, and compare against WorldMirror at matching positions.

Atlas cameras are camera-to-world RUB in a Y-up metric world. SplatTransform's camera arguments
use its engine frame; AXES maps Atlas world -> engine (found by matching a render to photo 1).
"""

import json
import math
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageOps

HERE = Path(__file__).resolve().parent
BOSTON = HERE.parent / "boston"
sys.path.insert(0, str(HERE.parent / "rooms"))
import evaluate as rooms  # noqa: E402

FONT = ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial.ttf", 15)


def rot(q):
    x, y, z, w = q
    return np.array([[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
                     [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
                     [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]])


def render(spz, out, position, quaternion, intrinsics, axes, size=(528, 704)):
    if out.exists():
        return out
    r = rot(quaternion)
    forward, up = r @ [0, 0, -1], r @ [0, 1, 0]
    a = np.asarray(axes, float)
    csv = lambda v: ",".join(f"{x:.8g}" for x in v)
    vfov = math.degrees(2 * math.atan(intrinsics["height"] / (2 * intrinsics["fy"])))
    rooms.cli(spz, out, "--camera-pos", csv(position * a), "--camera-target", csv((position + forward) * a),
              "--camera-up", csv(up * a), "--camera-fov", vfov, "--camera-near", 0.05,
              "--resolution", f"{size[0]}x{size[1]}", "--background", "0.09,0.09,0.09,1")
    return out


def find_axes(room_id, spz):
    """Try the sign flips and keep the one whose photo-1 render best matches photo 1."""
    root = HERE / room_id
    frame = json.loads((root / "pose/out/operation.json").read_text())["response"]["frames"][0]
    photo = np.asarray(Image.open(root / "pose/out" / frame["imageAsset"]["path"]).convert("L").resize((132, 176)), float)
    best = None
    for axes in ((1, 1, 1), (1, -1, -1), (-1, -1, 1), (-1, 1, -1)):
        out = root / f"axes-{axes[0]}{axes[1]}{axes[2]}.webp".replace("-1", "m")
        render(spz, out, np.array(frame["camera"]["extrinsics"]["position"]), frame["camera"]["extrinsics"]["quaternion"],
               frame["camera"]["intrinsics"], axes)
        img = np.asarray(Image.open(out).convert("L").resize((132, 176)), float)
        score = np.corrcoef(img.ravel(), photo.ravel())[0, 1]
        print(axes, round(score, 3))
        if best is None or score > best[0]:
            best = (score, axes)
    return best[1]




EVAL_T = {(2, 3): 0.3, (3, 4): 0.5, (4, 5): 0.5, (6, 7): 0.3, (7, 8): 0.375, (9, 10): 0.3}


def compare(room_id, spz, wm_config, out_name, axes=(-1, -1, 1)):
    """Rows: photo A | WorldMirror | Atlas | photo B, at positions no generated view used."""
    from generate import slerp  # same interpolation as the generated views
    root = HERE / room_id
    posed = json.loads((root / "pose/out/operation.json").read_text())["response"]["frames"]
    order = json.loads((root / "pose/photos.json").read_text())
    wm_dir = BOSTON / "outputs" / wm_config
    wm_row = next(r for r in json.loads((BOSTON / "results.json").read_text()) if r["directory"].endswith(wm_config))
    wm_cam = json.loads((wm_dir / "camera_params.json").read_text())
    wm_pose = {int(e["camera_id"]): np.asarray(e["matrix"]) for e in wm_cam["extrinsics"]}
    wm_k = {int(i["camera_id"]): np.asarray(i["matrix"]) for i in wm_cam["intrinsics"]}
    near = json.loads((wm_dir / "render-poses.json").read_text())["views"][0]["near"]
    w, h = 300, 400
    sheet = Image.new("RGB", (4 * (w + 8) + 8, 40 + len(EVAL_T) * (h + 28)), "#181a1f")
    draw = ImageDraw.Draw(sheet)
    draw.text((8, 10), f"{room_id} · photo A | WorldMirror {wm_config} | Atlas {spz.parent.parent.name} | photo B "
                       "(positions with no generated view)", font=FONT, fill="white")
    for row, ((a, b), t) in enumerate(EVAL_T.items()):
        fa, fb = posed[a - 1], posed[b - 1]
        pa, pb = (np.array(f["camera"]["extrinsics"]["position"]) for f in (fa, fb))
        q = slerp(fa["camera"]["extrinsics"]["quaternion"], fb["camera"]["extrinsics"]["quaternion"], t)
        atlas = render(spz, root / f"cmp-{spz.parent.parent.name}-{a}-{b}.webp", (1 - t) * pa + t * pb, q,
                       fa["camera"]["intrinsics"], axes)
        ia, ib = wm_row["photo_ids"].index(order[a - 1]), wm_row["photo_ids"].index(order[b - 1])
        ma, mb = wm_pose[ia], wm_pose[ib]
        origin = (1 - t) * ma[:3, 3] + t * mb[:3, 3]
        fwd = (1 - t) * ma[:3, 2] + t * mb[:3, 2]
        fwd /= np.linalg.norm(fwd)
        up = -((1 - t) * ma[:3, 1] + t * mb[:3, 1])
        up /= np.linalg.norm(up)
        vfov = math.degrees(2 * math.atan(wm_k[ia][1, 2] / wm_k[ia][1, 1]))
        wm_out = root / f"cmp-{wm_config}-{a}-{b}.webp"
        if not wm_out.exists():
            e = lambda v: ",".join(f"{x:.8g}" for x in v * rooms.PLY_TO_ENGINE)
            rooms.cli(wm_dir / "room-native.sog", wm_out, "--camera-pos", e(origin), "--camera-target", e(origin + fwd),
                      "--camera-up", e(up), "--camera-fov", vfov, "--camera-near", near, "--resolution", "528x704",
                      "--background", "0.09,0.09,0.09,1")
        y = 40 + row * (h + 28)
        draw.text((8, y), f"photos {a} → {b}, {t:.0%} of the way, {np.linalg.norm(pa - pb):.1f} m apart",
                  font=FONT, fill="#d7dae0")
        tiles = [root / "pose/out" / fa["imageAsset"]["path"], wm_out, atlas, root / "pose/out" / fb["imageAsset"]["path"]]
        for c, tile in enumerate(tiles):
            sheet.paste(ImageOps.fit(Image.open(tile).convert("RGB"), (w, h)), (8 + c * (w + 8), y + 22))
    sheet.save(root / out_name, quality=85)
    print(root / out_name)


if __name__ == "__main__":
    room_id, spz = sys.argv[1], Path(sys.argv[2]).resolve()
    if len(sys.argv) > 3:
        compare(room_id, spz, sys.argv[3], sys.argv[4])
    else:
        print("best axes:", find_axes(room_id, spz))
