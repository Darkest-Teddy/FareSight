"""Copy accepted restaurant dishes into web/public/assets-demo/ and write the manifest.

Reads sources/manifest.json (inputs, sources, prices) and review.json (dish -> {"provider", "portion"},
only dishes that passed the six-view check). Each 60k SOG is levelled, in metres, centred on x = z = 0
with its base on y = 0 (PlayCanvas Y-up). Stray Gaussians more than 5 mm below the base are cropped.
App files are named dish-<dish>.sog; files from rejected or removed dishes are deleted.
"""

import json
import os
import shutil
import subprocess
from pathlib import Path

HERE = Path(__file__).resolve().parent
EXP = HERE.parent
WEB = EXP.parents[1] / "web/public/assets-demo"
CLI = ["npx", "-y", "@playcanvas/splat-transform@3.12.0", "-g", "cpu", "-q"]
ENV = {**os.environ, "npm_config_cache": str(EXP / "rooms/outputs/npm-cache")}
PROVIDERS = {"sam": "SAM 3D Objects (fal)", "idol": "Idol (fal)"}
VENUE_PREFIX = ("dish-eljefes-", "dish-shudaxia-", "dish-starbucks-")


def stats(path):
    data = json.loads(subprocess.run([*CLI, str(path), "--stats", "json", "null"], capture_output=True, text=True,
                                     check=True, env=ENV).stdout)
    s = data["stats"][0]
    lo, hi = dict(zip(s["columns"], s["data"]["min"])), dict(zip(s["columns"], s["data"]["max"]))
    return data["numGaussians"], lo, hi


def main():
    photos = {p["dish"]: p for p in json.loads((HERE / "sources/manifest.json").read_text())}
    review = json.loads((HERE / "review.json").read_text())
    out, written = [], set()
    for dish, choice in review.items():
        p, provider = photos[dish], choice["provider"]
        job = json.loads((HERE / "outputs" / dish / provider / "attempt1/job.json").read_text())
        source = HERE / job["paths"]["60k"]
        name = f"dish-{dish}.sog"
        target = WEB / name
        count, lo, hi = stats(source)
        if lo["y"] < -0.005:
            # SplatTransform's filter frame has Y flipped, so filter-y <= 0.005 keeps data y >= -0.005.
            subprocess.run([*CLI, "-w", str(source), "-B", "-1,-1,-1,1,0.005,1", str(target)], check=True, env=ENV)
            count, lo, hi = stats(target)
        else:
            shutil.copyfile(source, target)
        written.add(name)
        out.append({
            "file": name, "venue_id": p["venue_id"], "dish_name": p["name"], "portion": choice["portion"],
            "listed_price_usd": p["listed_price_usd"], "price_source": p["price_source"]
            or ("Starbucks prices vary by store; none published" if "starbucks" in dish else "No price published by the restaurant"),
            "plate_diameter_m": p["target_width_m"],
            "measured_width_m": round(max(hi["x"] - lo["x"], hi["z"] - lo["z"]), 3),
            "height_m": round(hi["y"], 3), "base_y_m": round(lo["y"], 4),
            "centre_xz_m": [round((hi["x"] + lo["x"]) / 2, 3), round((hi["z"] + lo["z"]) / 2, 3)],
            "splats": count, "bytes": target.stat().st_size, "provider": PROVIDERS[provider],
            "generation_cost_usd": job["cost_usd"], "source_url": choice.get("source_url") or p["source_url"], "license": p["license"],
            "scale_status": "approximate", "scale_note": "Width is a nominal assumption from one photo, not a measured portion.",
            "review_note": choice.get("note"),
        })
    removed = []
    for old in sorted(WEB.glob("dish-*.sog")):
        if old.name.startswith(VENUE_PREFIX) and old.name not in written:
            old.unlink()
            removed.append(old.name)
    report = {"frame": "PlayCanvas Y-up, metres, centred on x = z = 0, base on y = 0, no rotation needed",
              "usage": "Demo only: restaurant marketing photos, copyright the restaurants; not for public release.",
              "counts": {v: sum(d["venue_id"] == v for d in out) for v in sorted({d["venue_id"] for d in out})},
              "dishes": out, "removed_from_app": removed}
    (EXP / "atlas/restaurant-dishes-export.json").write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n")
    print(json.dumps(report["counts"]), len(out), "dishes;", "removed", removed)


if __name__ == "__main__":
    main()
