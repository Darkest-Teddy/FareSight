"""Run this experiment's sequential Replicate matrix. Use --schema for a free check."""

import argparse
import base64
import fcntl
import json
import math
import re
import shutil
import time
import urllib.error
import urllib.request
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent
VERSION = "9ed0decf15c57cb21d40db281aa5183fce38dd2a57c09c9ab14b1254f57a8feb"
MODEL_URL = "/models/kfarr/tencent-hy-world-2.0"
API = "https://api.replicate.com/v1"
USER_AGENT = "FareSight-Room-Splat-Eval/1.0"
RATE = 0.000975
BUDGET = 6
TERMINAL = {"succeeded", "failed", "canceled", "aborted"}
RESULTS = ROOT / "results.json"
PENDING = ROOT / "outputs/pending-submission.json"


def token():
    dotenv = (ROOT.parents[2] / ".env").read_text()
    value = re.search(r"^\s*(?:export\s+)?REPLICATE_API_TOKEN\s*=\s*(.+)$", dotenv, re.M)
    if not value:
        raise SystemExit("REPLICATE_API_TOKEN missing from repository .env")
    return value[1].strip().strip("\"'")


def api(path, data=None, *, headers=None):
    request = urllib.request.Request(
        API + path, data=data,
        headers={"Authorization": f"Bearer {token()}", "Content-Type": "application/json",
                 "User-Agent": USER_AGENT, **(headers or {})},
    )
    with urllib.request.urlopen(request, timeout=90) as response:
        return json.load(response)


def write_json(path, value):
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(value, indent=2, ensure_ascii=False) + "\n")
    tmp.replace(path)


def schema():
    value = api(f"{MODEL_URL}/versions/{VERSION}")["openapi_schema"]["components"]["schemas"]
    fields = {key: value[key] for key in ("Input", "Output")}
    assert fields["Input"]["required"] == ["input_file"]
    assert fields["Input"]["properties"]["target_size"]["default"] == 952
    assert fields["Output"]["format"] == "uri"
    return fields


def archive(room, count, directory):
    assert len(room["photos"]) == 3
    path = directory / "input.zip"
    with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_STORED) as zipped:
        for i, photo in enumerate(room["photos"][:count], 1):
            zipped.write(ROOT / photo["path"], f"{i:02}.jpg")
    return path


def download(prediction, row, directory):
    bundle = directory / "replicate-output.zip"
    if not bundle.exists():
        temporary = bundle.with_suffix(".part")
        for attempt in range(3):
            try:
                request = urllib.request.Request(prediction["output"], headers={"User-Agent": USER_AGENT})
                with urllib.request.urlopen(request, timeout=90) as response, temporary.open("wb") as file:
                    shutil.copyfileobj(response, file)
                if not zipfile.is_zipfile(temporary):
                    raise ValueError("Prediction output is not a ZIP")
                temporary.replace(bundle)
                break
            except (OSError, ValueError):
                if attempt == 2:
                    raise
                time.sleep(3)
    with zipfile.ZipFile(bundle) as zipped:
        members = {Path(path).name: path for path in zipped.namelist()}
        for filename, key in (("gaussians.ply", "raw_ply"), ("camera_params.json", "camera_params")):
            path = directory / filename
            with zipped.open(members[filename]) as source, path.open("wb") as file:
                shutil.copyfileobj(source, file)
            row["output_paths"][key] = str(path.relative_to(ROOT))
    row["output_paths"]["archive"] = str(bundle.relative_to(ROOT))


def finish(prediction_id, rows, row, directory):
    status = None
    while True:
        try:
            prediction = api(f"/predictions/{prediction_id}")
        except urllib.error.HTTPError as error:
            if error.code < 500 and error.code != 429:
                raise
            time.sleep(8)
            continue
        except (OSError, ValueError) as error:
            print(f"{prediction_id}: polling error ({type(error).__name__}), retrying", flush=True)
            time.sleep(8)
            continue
        if prediction["status"] != status:
            status = prediction["status"]
            print(f"{directory.name}: {prediction_id} {status}", flush=True)
        if status in TERMINAL:
            break
        time.sleep(3)
    seconds = (prediction.get("metrics") or {}).get("predict_time")
    row.update(
        status=status, predict_time_s=seconds, cost_usd=None if seconds is None else round(seconds * RATE, 9),
        error=prediction.get("error"),
    )
    print(f"{directory.name}: {seconds}s, ${row['cost_usd']}", flush=True)
    write_json(RESULTS, rows)
    if status != "succeeded":
        return
    download(prediction, row, directory)
    write_json(RESULTS, rows)


def create_prediction(payload, remaining_seconds):
    for retry in range(4):
        try:
            return api("/predictions", payload, headers={"Cancel-After": f"{min(remaining_seconds, 900)}s"})
        except urllib.error.HTTPError as error:
            if error.code != 429 or retry == 3:
                raise
            try:
                delay = float(error.headers.get("Retry-After") or json.load(error).get("retry_after") or 10)
            except (ValueError, TypeError):
                delay = 10
            time.sleep(max(1, min(delay + 1, 30)))


def run(room_ids, configs, retry_failed):
    rooms = json.loads((ROOT / "sources/manifest.json").read_text())
    rows = json.loads(RESULTS.read_text()) if RESULTS.exists() else []
    if PENDING.exists():
        pending = json.loads(PENDING.read_text())
        if not any(row["directory"] == pending["directory"] and row.get("attempt", 1) == pending.get("attempt", 1)
                   for row in rows):
            raise SystemExit("An earlier submission has no recorded ID. Reconcile it against Replicate before running again.")
        PENDING.unlink()
    for row in rows:
        if row["status"] not in TERMINAL or (row["status"] == "succeeded" and not row["output_paths"]):
            finish(row["prediction_id"], rows, row, ROOT / row["directory"])
    for room in rooms:
        if room_ids and room["id"] not in room_ids:
            continue
        for count, resolution in configs:
            matches = [r for r in rows if (r["room_id"], r["n_photos"], r["resolution"]) == (room["id"], count, resolution)]
            if any(r["status"] == "succeeded" for r in matches) or (matches and not retry_failed):
                continue
            if any(r["cost_usd"] is None for r in rows):
                raise SystemExit("A terminal prediction has no predict_time. Resolve its spend before continuing.")
            remaining_seconds = math.floor((BUDGET - sum(r["cost_usd"] for r in rows)) / RATE)
            if remaining_seconds < 5:
                raise SystemExit("Less than five active seconds remain within the budget.")
            directory = ROOT / f"outputs/{room['id']}-{count}p-{resolution}"
            directory.mkdir(parents=True, exist_ok=True)
            path = archive(room, count, directory)
            # Cog's wrapper requires a .zip suffix, which the Files API download path drops.
            input_url = "data:application/zip;base64," + base64.b64encode(path.read_bytes()).decode("ascii")
            payload = {"version": VERSION, "input": {
                "input_file": input_url, "target_size": resolution, "save_gaussians": True,
                "save_camera": True, "save_depth": False, "save_normal": False, "save_points": False,
            }}
            relative = str(directory.relative_to(ROOT))
            attempt = len(matches) + 1
            write_json(PENDING, {"directory": relative, "attempt": attempt})
            try:
                prediction = create_prediction(json.dumps(payload).encode(), remaining_seconds)
            except urllib.error.HTTPError as error:
                if 400 <= error.code < 500 and error.code != 408:
                    write_json(ROOT / "outputs/last-rejected-submission.json", {
                        "directory": relative, "http_status": error.code, "prediction_id": None,
                    })
                    PENDING.unlink()
                raise
            row = {
                "restaurant": room["restaurant"], "room_id": room["id"], "n_photos": count,
                "resolution": resolution, "prediction_id": prediction["id"], "status": prediction["status"],
                "attempt": attempt, "input_encoding": "data:application/zip",
                "predict_time_s": None, "cost_usd": None, "directory": relative,
                "output_paths": {}, "stats": None, "scores": None, "publishable": None,
            }
            rows.append(row)
            write_json(RESULTS, rows)
            PENDING.unlink()
            finish(prediction["id"], rows, row, directory)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("rooms", nargs="*")
    parser.add_argument("--schema", action="store_true")
    parser.add_argument("--config", choices=("2p-518", "2p-952", "3p-518", "3p-952"), action="append")
    parser.add_argument("--retry-failed", action="store_true")
    args = parser.parse_args()
    if args.schema:
        data = schema()
        write_json(ROOT / "outputs/model-schema.json", data)
        print("Schema verified. Input is a ZIP URI, target_size defaults to 952, output is one URI.")
    else:
        configs = [(int(c[0]), int(c[3:])) for c in args.config] if args.config else [(n, s) for n in (2, 3) for s in (518, 952)]
        try:
            with (ROOT / "outputs/run.lock").open("a") as lock:
                fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
                run(args.rooms, configs, args.retry_failed)
        except urllib.error.HTTPError as error:
            detail = error.read().decode(errors="replace").replace(token(), "[redacted]")
            raise SystemExit(f"Replicate HTTP {error.code}: {detail[:500]}") from None
        except BlockingIOError:
            raise SystemExit("A matrix runner is already active.") from None
