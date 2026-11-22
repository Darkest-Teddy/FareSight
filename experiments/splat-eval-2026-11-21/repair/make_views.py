"""Render in-between views of a Boston splat for Difix to clean.

For each pair of consecutive real photos at least MIN_STEP_M apart, render at 1/3 and 2/3 of the way
from one to the other. The walk check later renders at 1/2, so these views are never the
evaluation poses. Writes views/<config>/jobs.json for fix_views.py.
"""

import json
import math
import sys
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
BOSTON = HERE.parent / "boston"
sys.path.insert(0, str(HERE.parent / "rooms"))
import evaluate as rooms  # noqa: E402

MIN_STEP_M = 0.8
SIZE = (576, 768)  # portrait 3:4 like the photos; Difix needs multiples of 8


def lerp_pose(pa, pb, t):
    forward = (1 - t) * pa[:3, 2] + t * pb[:3, 2]
    up = -((1 - t) * pa[:3, 1] + t * pb[:3, 1])
    if np.linalg.norm(forward) < 0.5:
        return None
    forward /= np.linalg.norm(forward)
    up -= forward * (up @ forward)
    up /= np.linalg.norm(up)
    origin = (1 - t) * pa[:3, 3] + t * pb[:3, 3]
    return origin, forward, up


def main(config):
    directory = BOSTON / "outputs" / config
    row = next(r for r in json.loads((BOSTON / "results.json").read_text()) if r["directory"].endswith(config))
    room = next(r for r in json.loads((BOSTON / "sources/manifest.json").read_text()) if r["id"] == row["room_id"])
    by_id = {p["id"]: p for p in room["photos"]}
    camera = json.loads((directory / "camera_params.json").read_text())
    poses = {int(e["camera_id"]): np.asarray(e["matrix"]) for e in camera["extrinsics"]}
    ks = {int(i["camera_id"]): np.asarray(i["matrix"]) for i in camera["intrinsics"]}
    setup = json.loads((directory / "render-poses.json").read_text())
    upm, near = setup["units_per_meter_estimate"], setup["views"][0]["near"]
    out = HERE / "views" / config
    out.mkdir(parents=True, exist_ok=True)
    jobs = []
    for a in range(1, len(poses) - 1):  # camera 0 is the hand-picked first photo, out of capture order
        b = a + 1
        step = np.linalg.norm(poses[a][:3, 3] - poses[b][:3, 3]) / upm
        if step < MIN_STEP_M:
            continue
        for t in (1 / 3, 2 / 3):
            pose = lerp_pose(poses[a], poses[b], t)
            if pose is None:
                continue
            origin, forward, up = pose
            vfov = math.degrees(2 * math.atan(ks[a][1, 2] / ks[a][1, 1]))
            name = f"between-{a:02}-{b:02}-t{round(t * 3)}of3"
            render = out / f"{name}.render.webp"
            if not render.exists():
                csv = lambda v: ",".join(f"{x:.8g}" for x in v * rooms.PLY_TO_ENGINE)
                rooms.cli(directory / "room-native.sog", render, "--camera-pos", csv(origin),
                          "--camera-target", csv(origin + forward), "--camera-up", csv(up),
                          "--camera-fov", vfov, "--camera-near", near,
                          "--resolution", f"{SIZE[0]}x{SIZE[1]}", "--background", "0,0,0,1")
            ref = row["photo_ids"][a if t < 0.5 else b]
            jobs.append({"name": name, "render": str(render), "ref": str(BOSTON / by_id[ref]["path"]),
                         "fixed": str(out / f"{name}.fixed.png"), "pair": [a, b], "t": t, "step_m": step})
    (out / "jobs.json").write_text(json.dumps(jobs, indent=2) + "\n")
    print(f"{len(jobs)} views -> {out / 'jobs.json'}")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "eljefes-kenmore-all-952")
