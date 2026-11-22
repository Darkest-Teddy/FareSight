"""Export Atlas rooms and the accepted dish splats into web/public/assets-demo/ for FareSight.

Rooms: decimate the refined Atlas splat to ROOM_SPLATS (adaptive), then move the chosen start photo's
camera to the app spawn [0, 1.55, 2] looking along -Z, floor on y = 0 (Atlas is gravity-levelled with
the ground at y = 0). Rooms whose median camera height is far from eye height are rescaled to metres.
Dishes: the accepted 60k SOG per dish (already levelled, metres, plate on y = 0, centred), with stray
Gaussians below the plate cropped.

Writes atlas/app-export.json with counts, bytes, spawn/plate data and checks. Spawn renders go to
atlas/<room>/app-spawn-check.webp.
"""

import json
import math
import shutil
import subprocess
import sys
from pathlib import Path

import numpy as np

from render import rot

HERE = Path(__file__).resolve().parent
EXP = HERE.parent
WEB = EXP.parents[1] / "web/public/assets-demo"
sys.path.insert(0, str(EXP / "rooms"))
import evaluate as rooms  # noqa: E402

ROOM_SPLATS = 350_000
SPAWN = (0.0, 1.55, 2.0)
EYE_M = 1.45
ROOMS = {  # room id -> (app file, start photo)
    "eljefes-kenmore": ("room-eljefes-atlas.sog", "IMG_5087"),
    "shudaxia-hotpot": ("room-shudaxia-atlas.sog", "IMG_5099"),
    "starbucks-warren": ("room-starbucks-atlas.sog", "IMG_5137"),  # customer side; 5130 looked through the glass partition into the bar
}
DISHES = {  # dish -> accepted attempt (SAM first, Idol where SAM failed); see dishes/report.md
    "ramen": "sam/attempt1", "curry": "sam/attempt1", "tiramisu": "idol/attempt2", "burger": "idol/attempt1",
    "cocktail": "sam/attempt2", "pizza": "sam/attempt1", "salad": "sam/attempt1", "sushi": "sam/attempt2",
}


def stats(path):
    out = subprocess.run(["npx", "-y", rooms.CLI, "-g", "cpu", "-q", str(path), "--stats", "json", "null"],
                         cwd=rooms.ROOT, capture_output=True, text=True, check=True,
                         env={**__import__("os").environ, "npm_config_cache": str(rooms.ROOT / "outputs/npm-cache")}).stdout
    data = json.loads(out)
    s = data["stats"][0]
    lo, hi = dict(zip(s["columns"], s["data"]["min"])), dict(zip(s["columns"], s["data"]["max"]))
    return data["numGaussians"], lo, hi


def export_room(room_id, app_file, start_photo):
    root = HERE / room_id
    posed = json.loads((root / "pose/out/operation.json").read_text())["response"]["frames"]
    order = json.loads((root / "pose/photos.json").read_text())
    frame = posed[order.index(start_photo)]
    c = np.array(frame["camera"]["extrinsics"]["position"])
    fwd = rot(frame["camera"]["extrinsics"]["quaternion"]) @ [0, 0, -1]
    yaw = -math.degrees(math.atan2(fwd[0], -fwd[2]))
    heights = np.array([f["camera"]["extrinsics"]["position"][1] for f in posed])
    scale = EYE_M / float(np.median(heights))
    scale = 1.0 if abs(scale - 1) < 0.15 else scale  # only fix clearly mis-scaled captures
    decimated = root / f"app-{ROOM_SPLATS // 1000}k.ply"
    if not decimated.exists():
        rooms.cli("-g", "cpu", root / "splats-refined/out/refinedSplats_2000000.spz",
                  "--decimate-adaptive", ROOM_SPLATS, decimated)
    out = WEB / app_file
    # SplatTransform applies -t/-r/-B in its engine frame, where X and Y are negated relative to the
    # loaded data. So the X translation is +c[0] (data moves by -c[0]) and the yaw sign is inverted.
    rooms.cli("-g", "cpu", "-w", decimated, "-t", f"{c[0]},0,{-c[2]}", "-r", f"0,{yaw},0", "-s", scale,
              "-t", f"{SPAWN[0]},0,{SPAWN[2]}",
              # Crop far floaters (street through windows, sky): +-20 m around spawn, floor to 6 m.
              # The filter frame has X and Y flipped, so y in [-6, 0.5] keeps data y in [-0.5, 6].
              "-B", f"-20,-6,{SPAWN[2] - 20},20,0.5,{SPAWN[2] + 20}", out)
    check = root / "app-spawn-check.webp"
    rooms.cli("-w", out, check, "--camera-pos", f"0,{-SPAWN[1]},{SPAWN[2]}",
              "--camera-target", f"0,{-SPAWN[1]},{SPAWN[2] - 1}", "--camera-up", "0,-1,0", "--camera-fov", 90,
              "--resolution", "528x704", "--background", "0.09,0.09,0.09,1")
    count, lo, hi = stats(out)
    return {"file": app_file, "kind": "room", "splats": count, "bytes": out.stat().st_size,
            "spawn_point": list(SPAWN), "start_photo": start_photo, "scale_applied": round(scale, 3),
            "photo_camera_height_m": round(float(c[1]) * scale, 2), "yaw_deg": round(yaw, 1),
            "bounds_m": {"min": [round(lo[k], 2) for k in "xyz"], "max": [round(hi[k], 2) for k in "xyz"]},
            "spawn_check_render": str(check.relative_to(EXP))}


def export_dish(dish, attempt):
    manifest = {m["dish"]: m for m in json.loads((EXP / "dishes/sources/manifest.json").read_text())}
    source = EXP / "dishes/outputs" / dish / attempt / "60k.sog"
    out = WEB / f"dish-{dish}-real.sog"
    count, lo, hi = stats(source)
    if lo["y"] < -0.005:  # stray Gaussians under the plate (tiramisu has a 12-splat cluster)
        # SplatTransform's filter frame has Y flipped (engine frame), so keep filter-y <= 0.005.
        rooms.cli("-g", "cpu", "-w", source, "-B", "-1,-1,-1,1,0.005,1", out)
        count, lo, hi = stats(out)
    else:
        shutil.copyfile(source, out)
    return {"file": out.name, "kind": "dish", "splats": count, "bytes": out.stat().st_size,
            "provider": attempt.split("/")[0], "source_attempt": f"dishes/outputs/{dish}/{attempt}",
            "plate_diameter_m": manifest[dish]["target_width_m"],
            "measured_width_m": round(max(hi["x"] - lo["x"], hi["z"] - lo["z"]), 3),
            "height_m": round(hi["y"], 3), "base_y_m": round(lo["y"], 4),
            "photo_credit": {k: manifest[dish][k] for k in ("author", "license", "page")}}


if __name__ == "__main__":
    # python3 export_app.py [room_id start_photo]  -- rooms only; dishes now come from ../restaurant-dishes.
    WEB.mkdir(parents=True, exist_ok=True)
    report_path = HERE / "app-export.json"
    report = json.loads(report_path.read_text()) if report_path.exists() else {"rooms": []}
    report.pop("dishes", None)
    todo = {sys.argv[1]: (ROOMS[sys.argv[1]][0], sys.argv[2])} if len(sys.argv) > 2 else ROOMS
    for room_id, (app_file, photo) in todo.items():
        entry = export_room(room_id, app_file, photo)
        report["rooms"] = [r for r in report["rooms"] if r["file"] != app_file] + [entry]
    report_path.write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report["rooms"], indent=2))
