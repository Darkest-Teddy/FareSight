"""WorldMirror 2.0 on the team's own Boston walk-through photos.

Reuses the Replicate client from ../rooms/run.py, pointed at this folder's ledger. Configs:
  all-518 / all-952  every interior photo in the manifest
  3p-518             the three-photo subset, for comparison with the original two-or-three-photo policy
Indoor runs set apply_sky_mask=false. Photos are resized to target_size on the long edge before upload.
"""

import argparse
import base64
import fcntl
import io
import json
import math
import sys
import urllib.error
import zipfile
from pathlib import Path

from PIL import Image

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "rooms"))
import run as replicate  # noqa: E402

# rooms/run.py resolves ledger and output paths through these module globals.
replicate.ROOT = HERE
replicate.RESULTS = HERE / "results.json"
RESULTS = replicate.RESULTS
BUDGET = 3
CONFIGS = {"all-518": (None, 518), "all-952": (None, 952), "3p-518": (3, 518)}


def photos_for(room, count):
    if count is None:
        return room["photos"]
    subset = room["three_photo_subset"]
    return sorted((p for p in room["photos"] if p["id"] in subset), key=lambda p: subset.index(p["id"]))


def archive(photos, size, directory):
    path = directory / "input.zip"
    with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_STORED) as zipped:
        for i, photo in enumerate(photos, 1):
            image = Image.open(HERE / photo["path"]).convert("RGB")
            image.thumbnail((size, size), Image.LANCZOS)
            buffer = io.BytesIO()
            image.save(buffer, "JPEG", quality=93)
            zipped.writestr(f"{i:02}.jpg", buffer.getvalue())
    return path


def run(room_ids, config_names):
    rooms = json.loads((HERE / "sources/manifest.json").read_text())
    rows = json.loads(RESULTS.read_text()) if RESULTS.exists() else []
    for row in rows:
        if row["status"] not in replicate.TERMINAL:
            replicate.finish(row["prediction_id"], rows, row, HERE / row["directory"])
    for room in rooms:
        if room_ids and room["id"] not in room_ids:
            continue
        for name in config_names:
            count, size = CONFIGS[name]
            if any(r["room_id"] == room["id"] and r["config"] == name and r["status"] == "succeeded" for r in rows):
                continue
            spent = sum(r["cost_usd"] or 0 for r in rows)
            remaining_seconds = math.floor((BUDGET - spent) / replicate.RATE)
            if remaining_seconds < 30:
                raise SystemExit(f"Budget ${BUDGET} nearly spent (${spent:.4f}).")
            photos = photos_for(room, count)
            directory = HERE / f"outputs/{room['id']}-{name}"
            directory.mkdir(parents=True, exist_ok=True)
            path = archive(photos, size, directory)
            payload = {"version": replicate.VERSION, "input": {
                "input_file": "data:application/zip;base64," + base64.b64encode(path.read_bytes()).decode("ascii"),
                "target_size": size, "apply_sky_mask": False, "save_gaussians": True, "save_camera": True,
                "save_depth": False, "save_normal": False, "save_points": False,
            }}
            print(f"{directory.name}: submitting {len(photos)} photos, {path.stat().st_size / 1e6:.1f} MB", flush=True)
            prediction = replicate.create_prediction(json.dumps(payload).encode(), remaining_seconds)
            row = {
                "restaurant": room["restaurant"], "room_id": room["id"], "config": name,
                "n_photos": len(photos), "resolution": size, "photo_ids": [p["id"] for p in photos],
                "apply_sky_mask": False, "prediction_id": prediction["id"], "status": prediction["status"],
                "attempt": 1 + sum(r["room_id"] == room["id"] and r["config"] == name for r in rows),
                "predict_time_s": None, "cost_usd": None, "directory": str(directory.relative_to(HERE)),
                "output_paths": {}, "stats": None, "scores": None, "publishable": None,
            }
            rows.append(row)
            replicate.write_json(RESULTS, rows)
            replicate.finish(prediction["id"], rows, row, directory)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("rooms", nargs="*")
    parser.add_argument("--config", choices=CONFIGS, action="append")
    args = parser.parse_args()
    (HERE / "outputs").mkdir(exist_ok=True)
    try:
        with (HERE / "outputs/run.lock").open("a") as lock:
            fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
            run(args.rooms, args.config or list(CONFIGS))
    except urllib.error.HTTPError as error:
        detail = error.read().decode(errors="replace").replace(replicate.token(), "[redacted]")
        raise SystemExit(f"Replicate HTTP {error.code}: {detail[:500]}") from None
    except BlockingIOError:
        raise SystemExit("A runner is already active.") from None
