"""Step 3: reconstruct Gaussian splats from the posed photos plus the generated views.

Usage: python3 splats.py eljefes-kenmore [--refine]
  draft  (refine: false): $0.50, ~30 s, 2-32 frames  -> <room>/splats-draft/out/
  refine (default task):  $5.00, ~15-21 min          -> <room>/splats-refined/out/
"""

import json
import sys
from pathlib import Path

import wl

HERE = Path(__file__).resolve().parent


def frames_from(operation_json):
    out = []
    for f in json.loads(operation_json.read_text())["response"]["frames"]:
        depth = (f.get("depth") or {}).get("depthAsset")
        if not depth:
            raise SystemExit(f"frame without depth in {operation_json}")
        out.append({"imageAsset": {"assetId": f["imageAsset"]["assetId"]},
                    "depth": {"depthAsset": {"assetId": depth["assetId"]}}, "camera": f["camera"]})
    return out


def main(room_id, refine):
    root = HERE / room_id
    frames = frames_from(root / "pose/out/operation.json") + frames_from(root / "generate/out/operation.json")
    sizes = {(f["camera"]["intrinsics"]["width"], f["camera"]["intrinsics"]["height"]) for f in frames}
    assert len(sizes) == 1, f"frames use several grids: {sizes}"
    request = {"posedFrames": frames, "refine": refine}
    name = "splats-refined" if refine else "splats-draft"
    print(f"{len(frames)} posed frames on {sizes.pop()}, refine={refine}", flush=True)
    operation = wl.run_task("posedImages2Splats", request, root / name, f"faresight-{room_id}-{name}-v1", wait_s=3600)
    response = operation["response"]
    print(json.dumps({k: v for k, v in response.items() if k in ("draftSplat", "refinedSplats")}, indent=2)[:1200])


if __name__ == "__main__":
    main(sys.argv[1], "--refine" in sys.argv[2:])
