"""Step 1: upload a Boston room's photos and estimate cameras + depth with images2PosedRGBD.

Usage: python3 pose.py eljefes-kenmore
Output: <room>/pose/out/ (images, depth EXRs, operation.json with cameras)
"""

import json
import sys
from pathlib import Path

import wl

HERE = Path(__file__).resolve().parent
BOSTON = HERE.parent / "boston"


def main(room_id):
    room = next(r for r in json.loads((BOSTON / "sources/manifest.json").read_text()) if r["id"] == room_id)
    photos = [BOSTON / p["path"] for p in room["photos"] if not p.get("synthetic")]
    # Capture order (the manifest puts a hand-picked view first; restore chronological order).
    photos.sort(key=lambda p: p.stem)
    root = HERE / room_id
    root.mkdir(exist_ok=True)
    cache_path = root / "assets.json"
    cache = json.loads(cache_path.read_text()) if cache_path.exists() else {}
    frames = []
    for photo in photos:
        frames.append({"imageAsset": {"assetId": wl.upload(photo, cache)}})
        cache_path.write_text(json.dumps(cache, indent=2) + "\n")
    request = {"frames": frames, "targetResolution": [528, 704], "refinePoses": True}
    operation = wl.run_task("images2PosedRGBD", request, root / "pose", f"faresight-{room_id}-pose-v1")
    (root / "pose/photos.json").write_text(json.dumps([p.stem for p in photos], indent=2) + "\n")
    frames = operation["response"]["frames"]
    print(f"{len(frames)} posed frames; poseRefinementAccepted={operation['response'].get('poseRefinementAccepted')}")


if __name__ == "__main__":
    main(sys.argv[1])
