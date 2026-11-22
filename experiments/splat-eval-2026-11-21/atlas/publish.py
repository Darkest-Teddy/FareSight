"""Step 4: turn a refined Atlas result into viewer assets.

Writes <room>/viewer/: SOG tiers converted from the returned SPZ files, render-poses.json in the
viewer's frame. The viewer assumes +Y is up, and Atlas's world is already Y-up, so poses stay in
Atlas world coordinates and the catalogue sets rootRoll 0 (WorldMirror rooms instead get a 180° roll),
and viewer.json with the catalogue metadata the viewer server reads.

Usage: python3 publish.py eljefes-kenmore
"""

import json
import math
import sys
from pathlib import Path

import numpy as np

from generate import slerp
from render import rot

HERE = Path(__file__).resolve().parent
BOSTON = HERE.parent / "boston"
sys.path.insert(0, str(HERE.parent / "rooms"))
import evaluate as rooms  # noqa: E402

AXES = np.array([1.0, 1.0, 1.0])  # viewer frame = Atlas world (Y-up)
REFINE_USD = 5.0


def view(label, key, position, quaternion, intrinsics, upm, origin):
    r = rot(quaternion)
    forward, up = r @ [0, 0, -1], r @ [0, 1, 0]
    return {"id": key, "label": label, "position": (position * AXES).tolist(),
            "target": ((position + forward) * AXES).tolist(), "up": (up * AXES).tolist(),
            "vertical_fov_deg": math.degrees(2 * math.atan(intrinsics["height"] / (2 * intrinsics["fy"]))),
            "pixels": [intrinsics["width"], intrinsics["height"]], "near": 0.05 * upm,
            "translation_from_photo_1_m_estimate": float(np.linalg.norm(position - origin) / upm)}


def main(room_id):
    root = HERE / room_id
    out = root / "viewer"
    out.mkdir(exist_ok=True)
    manifest = {r["id"]: r for r in json.loads((BOSTON / "sources/manifest.json").read_text())}
    room = manifest[room_id]
    refined = json.loads((root / "splats-refined/out/operation.json").read_text())["response"]["refinedSplats"]
    posed = json.loads((root / "pose/out/operation.json").read_text())["response"]["frames"]
    order = json.loads((root / "pose/photos.json").read_text())
    generated = len(json.loads((root / "generate/out/operation.json").read_text())["response"]["frames"])

    # Atlas is metric in principle; correct a mis-scaled capture with an assumed 1.45 m eye height.
    heights = np.array([f["camera"]["extrinsics"]["position"][1] for f in posed])
    upm = float(np.median(heights) / 1.45)

    tiers = []
    for count, entry in sorted(refined.items(), key=lambda kv: -int(kv[0])):
        spz = root / "splats-refined/out" / entry["path"]
        sog = out / f"room-{count}.sog"
        if not sog.exists():
            rooms.cli("-g", "cpu", spz, sog)
        tiers.append({"count": int(count), "file": sog.name, "bytes": sog.stat().st_size})
    # Smaller tiers for Quest, decimated from the largest refined splat (already logit opacity; no fix needed).
    largest = root / "splats-refined/out" / max(refined.items(), key=lambda kv: int(kv[0]))[1]["path"]
    for target in (1_000_000, 500_000):
        if all(t["count"] > target for t in tiers):
            sog = out / f"room-{target}.sog"
            if not sog.exists():
                decimated = out / f"decimated-{target}.ply"
                if not decimated.exists():
                    rooms.cli("-g", "cpu", largest, "--decimate", target, decimated)
                rooms.cli("-g", "cpu", decimated, sog)
                decimated.unlink()
            tiers.append({"count": target, "file": sog.name, "bytes": sog.stat().st_size})
    tiers.sort(key=lambda t: t["count"])  # viewer opens the first (smallest) tier by default

    first = order.index(room["photos"][0]["id"])  # the hand-picked start photo
    f0 = posed[first]
    origin = np.array(f0["camera"]["extrinsics"]["position"])
    views = [view("Photo 1 pose", "photo-1", origin, f0["camera"]["extrinsics"]["quaternion"],
                  f0["camera"]["intrinsics"], upm, origin)]
    # Halfway between the most widely spaced consecutive photos: the places WorldMirror broke.
    steps = sorted(range(len(posed) - 1), key=lambda i: -np.linalg.norm(
        np.subtract(posed[i]["camera"]["extrinsics"]["position"], posed[i + 1]["camera"]["extrinsics"]["position"])))
    for i in sorted(steps[:4]):
        a, b = posed[i], posed[i + 1]
        pa, pb = (np.array(f["camera"]["extrinsics"]["position"]) for f in (a, b))
        q = slerp(a["camera"]["extrinsics"]["quaternion"], b["camera"]["extrinsics"]["quaternion"], 0.5)
        views.append(view(f"Between photos {i + 1} and {i + 2}", f"gap-{i + 1}", (pa + pb) / 2, q,
                          a["camera"]["intrinsics"], upm, origin))
    poses = {"pose_source": "Atlas images2PosedRGBD camera (RUB, Y-up); viewer frame = Atlas world",
             "units_per_meter_estimate": upm, "reference_height_m_estimate": 1.45, "views": views}
    (out / "render-poses.json").write_text(json.dumps(poses, indent=2) + "\n")
    meta = {"room_id": room_id, "restaurant": room["restaurant"], "photos": len(posed), "generated": generated,
            "refine_usd": REFINE_USD, "tiers": tiers, "photo_ids": [order[first]] + [o for o in order if o != order[first]]}
    (out / "viewer.json").write_text(json.dumps(meta, indent=2) + "\n")
    print(json.dumps(meta, indent=2))


if __name__ == "__main__":
    main(sys.argv[1])
