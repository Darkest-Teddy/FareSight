"""Step 2: generate gap-filling views with atlasGenerate from the posed photos.

Targets:
  * along the walk: between consecutive photos more than MIN_GAP_M apart, at evenly spaced
    points (about one per metre), orientation slerped between the two photos;
  * side views: at a few positions along the walk, turned 90° left and right, to cover what
    no photo looked at.
All targets go in one request so Atlas decides the unseen parts once for all of them.

Usage: python3 generate.py eljefes-kenmore "<scene description>"
"""

import json
import math
import sys
from pathlib import Path

import numpy as np

import wl

HERE = Path(__file__).resolve().parent
MIN_GAP_M = 0.7
W, H = 528, 704


def qmul(a, b):
    ax, ay, az, aw = a
    bx, by, bz, bw = b
    return np.array([aw * bx + ax * bw + ay * bz - az * by, aw * by - ax * bz + ay * bw + az * bx,
                     aw * bz + ax * by - ay * bx + az * bw, aw * bw - ax * bx - ay * by - az * bz])


def slerp(a, b, t):
    a, b = np.asarray(a, float), np.asarray(b, float)
    if a @ b < 0:
        b = -b
    dot = min(1.0, a @ b)
    if dot > 0.9995:
        q = a + t * (b - a)
    else:
        theta = math.acos(dot)
        q = (math.sin((1 - t) * theta) * a + math.sin(t * theta) * b) / math.sin(theta)
    return q / np.linalg.norm(q)


def yaw(q, degrees):
    """Turn a camera about world +Y (Y-up world). Positive = left in RUB."""
    half = math.radians(degrees) / 2
    return qmul(np.array([0, math.sin(half), 0, math.cos(half)]), q)


def camera(position, quaternion, fx, fy):
    return {"intrinsics": {"fx": fx, "fy": fy, "cx": W / 2, "cy": H / 2, "width": W, "height": H},
            "extrinsics": {"position": [float(v) for v in position], "quaternion": [float(v) for v in quaternion],
                           "coordinateSystem": "rub"}}


def main(room_id, prompt):
    root = HERE / room_id
    posed = json.loads((root / "pose/out/operation.json").read_text())["response"]["frames"]
    fx = float(np.median([f["camera"]["intrinsics"]["fx"] for f in posed]))
    fy = float(np.median([f["camera"]["intrinsics"]["fy"] for f in posed]))
    pos = [np.array(f["camera"]["extrinsics"]["position"]) for f in posed]
    quat = [np.array(f["camera"]["extrinsics"]["quaternion"]) for f in posed]

    targets, labels = [], []
    walk_points = []
    for a in range(len(posed) - 1):
        step = np.linalg.norm(pos[a] - pos[a + 1])
        if step < MIN_GAP_M:
            continue
        n = max(1, round(step))  # about one view per metre
        for i in range(1, n + 1):
            t = i / (n + 1)
            p = (1 - t) * pos[a] + t * pos[a + 1]
            q = slerp(quat[a], quat[a + 1], t)
            targets.append(camera(p, q, fx, fy))
            labels.append(f"walk {a + 1}->{a + 2} t={t:.2f}")
            walk_points.append((p, q))
    # Side views from three positions spread along the walk.
    for k in np.linspace(0, len(walk_points) - 1, 3).round().astype(int) if walk_points else []:
        p, q = walk_points[k]
        for turn in (90, -90):
            targets.append(camera(p, yaw(q, turn), fx, fy))
            labels.append(f"side {'left' if turn > 0 else 'right'} at walk view {k}")

    context = [{"imageAsset": {"assetId": f["imageAsset"]["assetId"]},
                "depth": {"depthAsset": {"assetId": f["depth"]["depthAsset"]["assetId"]}},
                "camera": f["camera"]} for f in posed]
    request = {"contextFrames": context, "targetCameras": targets, "returnDepth": True, "prompt": prompt}
    print(f"{len(context)} context frames, {len(targets)} targets", flush=True)
    (root / "generate").mkdir(parents=True, exist_ok=True)
    (root / "generate/labels.json").write_text(json.dumps(labels, indent=2) + "\n")
    operation = wl.run_task("atlasGenerate", request, root / "generate", f"faresight-{room_id}-generate-v1")
    frames = operation["response"]["frames"]
    print(f"{len(frames)} generated frames; promptUsed: {operation['response'].get('promptUsed', '')[:200]}")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
