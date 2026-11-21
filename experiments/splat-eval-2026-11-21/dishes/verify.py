"""Verify the dish campaign offline. Run python3 verify.py from any directory."""
import argparse
from collections import Counter, defaultdict
from datetime import datetime, timedelta
from decimal import Decimal
from io import BytesIO
import hashlib
import json
import math
from pathlib import Path
import re
import sys
import zipfile

import numpy as np
from PIL import Image, ImageOps

ROOT = Path(__file__).resolve().parent
DISHES = set("ramen curry tiramisu burger cocktail pizza sushi salad".split())
HOST = {"sam": "fal", "idol": "fal", "trellis": "replicate"}
VIEWS = ("front", "side", "top", "back", "minus30", "plus30")
RUBRIC = set("arrangement vessel_completeness height rotation_cleanliness compression_recognizability".split())
LEGACY_403 = ("ramen", "idol", 1, "2026-11-21T16:46:35.360Z")


def require(condition, message):
    if not condition:
        raise ValueError(message)


def read_json(path):
    return json.loads(path.read_text(encoding="utf-8"))


def local(root, name):
    require(isinstance(name, str) and name.strip(), f"invalid local path {name!r}")
    path = (root / name).resolve()
    require(path.is_relative_to(root) and path.is_file(), f"missing or outside experiment: {name}")
    return path


def check_paths(root, value):
    if isinstance(value, dict):
        for child in value.values():
            check_paths(root, child)
    elif isinstance(value, list):
        for child in value:
            check_paths(root, child)
    else:
        local(root, value)


def number(value):
    return type(value) in (int, float) and math.isfinite(value)


def close(actual, recorded, label):
    require(np.shape(actual) == np.shape(recorded) and
            np.allclose(actual, recorded, rtol=2e-5, atol=1e-7), f"{label} differs from artifact")


def check_ply(path, stats):
    size = path.stat().st_size
    require(stats["raw_bytes"] == size, "raw PLY byte count differs")
    with path.open("rb") as file:
        header = file.read(65536).partition(b"end_header\n")
    require(header[1], "missing PLY header terminator")
    lines = header[0].decode("ascii").splitlines()
    require(lines[:2] == ["ply", "format binary_little_endian 1.0"], "unexpected PLY format")
    elements = [line for line in lines if line.startswith("element ")]
    require(len(elements) == 1 and elements[0].startswith("element vertex "), "expected vertex-only PLY")
    count = int(elements[0].split()[2])
    props = [line.split() for line in lines if line.startswith("property ")]
    require(all(len(p) == 3 and p[1] in {"float", "float32"} for p in props), "unexpected PLY property")
    require({"x", "y", "z", "scale_0", "scale_1", "scale_2"} <= {p[2] for p in props},
            "missing Gaussian PLY properties")
    require(count == stats["count"] and count > 0, "raw PLY vertex count differs")
    require(len(header[0]) + len(header[1]) + 4 * count * len(props) == size, "truncated or oversized PLY")


def check_sog(path, tier, expected):
    require(path.stat().st_size == tier["bytes"], f"{path.name} byte count differs")
    with zipfile.ZipFile(path) as archive:
        require(archive.testzip() is None, f"{path.name} CRC failure")
        meta = json.loads(archive.read("meta.json"))
        require(meta["count"] == expected == tier["count"], f"{path.name} Gaussian count differs")
        require(meta["version"] == tier["version"] == 3, f"{path.name} version differs")
        for key in ("means", "scales", "quats", "sh0"):
            for member in meta[key]["files"]:
                require(archive.getinfo(member).file_size > 0, f"empty {member} in {path.name}")
        means = meta["means"]
        planes = []
        for member in means["files"]:
            with Image.open(BytesIO(archive.read(member))) as im:
                planes.append(np.asarray(im.convert("RGB"), dtype=np.uint32).reshape(-1, 3)[:expected])
        lower, upper = planes
        require(lower.shape == upper.shape == (expected, 3), f"short position texture in {path.name}")
    # SOG v3 stores the two bytes of each log-transformed coordinate in separate textures.
    unit = (lower + 256 * upper) / 65535
    packed = unit * (np.subtract(means["maxs"], means["mins"])) + means["mins"]
    xyz = np.sign(packed) * np.expm1(np.abs(packed))
    horizontal = xyz[:, [0, 2]]
    lo, hi = np.quantile(horizontal, [.05, .95], axis=0)
    close(float(max(hi - lo)), tier["decoded_robust_width_m"], f"{path.name} robust width")
    close(float(max(np.ptp(horizontal, axis=0))), tier["decoded_full_width_m"], f"{path.name} full width")
    close([xyz[:, 1].min(), xyz[:, 1].max()], tier["decoded_y_range_m"], f"{path.name} Y bounds")


def check_views(root, paths, stats, folder):
    angles = stats["camera_angles_deg"]
    require(set(angles) == set(paths["views"]) == set(VIEWS), "incorrect six-view set")
    az, el = angles["front"]
    expected = [(az, el), (az + 90, 5), (az, 90), (az + 180, 20), (az - 30, el), (az + 30, el)]
    target = np.array([0, stats["camera_target_y_m"], 0])
    distance = stats["frame_size_m"] * 2.55
    require(number(distance) and distance > 0, "invalid camera distance")
    renders = [paths["views"][v] for v in VIEWS] + [paths["front30k"], paths["front_raw"]]
    filenames = [f"view.{i:04}.webp" for i in range(len(VIEWS))] + ["low.0000.webp", "full.0000.webp"]
    for name, filename in zip(renders, filenames):
        path = local(root, name)
        require(path == folder / filename, f"wrong render for {filename}: {name}")
        with Image.open(path) as image:
            image.load()
            require(image.size == (512, 512), f"expected 512×512: {name}")
            require(any(a < b for a, b in image.convert("RGB").getextrema()), f"blank render: {name}")
    for prefix, labels in (("view", VIEWS), ("low", ["front"]), ("full", ["front"])):
        track = local(root, str(folder / f"{prefix}-cameras.json"))
        frames = read_json(track)["frames"]
        require(len(frames) == len(labels), f"wrong {prefix} camera count")
        for i, (label, frame) in enumerate(zip(labels, frames)):
            a, e = angles[label]
            ea, ee = expected[i]
            require(math.isclose((a - ea + 180) % 360 - 180, 0, abs_tol=1e-8) and e == ee,
                    f"{label} camera angle differs")
            a, e = map(math.radians, (a, e))
            direction = np.array([math.sin(a) * math.cos(e), math.sin(e), math.cos(a) * math.cos(e)])
            close(frame["position"], target + distance * direction, f"{prefix} {label} camera position")
            close(frame["target"], target, f"{prefix} {label} camera target")
            close(frame["up"], [-math.sin(a), 0, -math.cos(a)] if ee == 90 else [0, 1, 0],
                  f"{prefix} {label} up vector")
            require(frame["fov"] == 32, f"unexpected {prefix} field of view")


def check_success(root, row, photo, folder):
    paths, stats = row["paths"], row["stats"]
    for name in ("raw", "normalized", "30k", "60k"):
        require(local(root, paths[name]).parent == folder, f"{name} belongs to another job")
    check_ply(local(root, paths["raw"]), stats)
    close(stats["target_width_m"], photo["target_width_m"], "source target width")
    require(stats["scale_factor"] > 0 and stats["calibration_width"] > 0, "invalid scale")
    close(stats["scale_factor"] * stats["calibration_width"], photo["target_width_m"], "calibrated width")
    for name, limit in (("30k", 30000), ("60k", 60000)):
        check_sog(local(root, paths[name]), stats["tiers"][name], min(stats["count"], limit))
    check_views(root, paths, stats, folder)
    scores = row["scores"]
    require(set(scores) == RUBRIC and all(type(s) is int and 1 <= s <= 5 for s in scores.values()),
            "expected five integer rubric scores from 1 to 5")
    evidence = row["score_evidence"]
    require(isinstance(evidence, str) and evidence.strip() or
            isinstance(evidence, dict) and set(evidence) == RUBRIC and
            all(isinstance(v, str) and v.strip() for v in evidence.values()), "missing review evidence")
    require(type(row["accepted"]) is bool and row["accepted"] is row["publishable"],
            "accepted and publishable must be matching booleans")


def rejection_key(r):
    fields = ("dish", "provider", "host", "submission_number", "attempt", "stage", "http_status",
              "timestamp_utc", "rejection_body")
    return tuple(r.get(k) for k in fields)


def check_rejection(r, report):
    require(r.get("job_id") is None and r["cost_usd"] == 0, "rejected submission has ID or cost")
    require(type(r["http_status"]) is int and 400 <= r["http_status"] < 600, "invalid HTTP status")
    if r["host"] == "fal" and r["http_status"] == 403:
        stamp = r["timestamp_utc"]
        require("T" in stamp and datetime.fromisoformat(stamp.replace("Z", "+00:00")).utcoffset()
                == timedelta(0), "403 timestamp must include UTC offset")
        key = (r["dish"], r["provider"], r.get("submission_number"), stamp)
        if key == LEGACY_403 and r["rejection_body"] is None:
            require(re.search(r"(?:body|bodies|response)[^\n]{0,150}(?:null|lost|unavailable|missing|uncaptured|unrecorded|not |wasn.t|wasn’t)|"
                              r"(?:null|unavailable|missing|uncaptured|unrecorded)[^\n]{0,80}(?:body|response)",
                              report, re.I), "report must disclose the original missing fal 403 body")
        else:
            require(isinstance(r["rejection_body"], str) and r["rejection_body"].strip(), "empty fal 403 body")


def check_tile(root, sheet, name, box, label):
    x, y, w, h = box
    with Image.open(local(root, name)) as im:
        tile = ImageOps.contain(ImageOps.exif_transpose(im).convert("RGB"), (w, h))
    x += (w - tile.width) // 2
    y += (h - tile.height) // 2
    require(sheet.crop((x, y, x + tile.width, y + tile.height)).tobytes() == tile.tobytes(),
            f"sheet tile differs from {label}")


def check_sheet(root, dish, photo, rows):
    path = local(root, f"outputs/contact-sheets/{dish}.png")
    with Image.open(path) as im:
        require(im.format == "PNG" and im.size == (1980, 940), f"{dish} sheet format or dimensions")
        sheet = im.convert("RGB")
    check_tile(root, sheet, photo["filename"], (18, 98, 270, 600), f"{dish} source")
    for i, provider in enumerate(HOST):
        candidates = [r for r in rows if r["provider"] == provider and r["status"] == "succeeded"]
        if not candidates:
            continue
        chosen = max(candidates, key=lambda r: (r["publishable"] is True, r["attempt"]))
        paths = chosen["paths"]
        for j, name in enumerate([paths["views"][v] for v in VIEWS] + [paths["front30k"]]):
            box = (305 + j * 239, 117 + i * 278, 232, 225)
            check_tile(root, sheet, name, box, f"{dish}/{provider} column {j + 1}")


def verify(root):
    rows = read_json(local(root, "results.json"))
    report = local(root, "report.md").read_text(encoding="utf-8")
    manifest = read_json(local(root, "sources/manifest.json"))
    photos = {p["dish"]: p for p in manifest}
    require(isinstance(rows, list) and rows, "results must be a nonempty list")
    require(set(photos) == DISHES and len(manifest) == len(DISHES), "expected eight named source dishes")
    for dish, p in photos.items():
        path = local(root, p["filename"])
        require(hashlib.sha256(path.read_bytes()).hexdigest() == p["sha256"], f"{dish} source SHA-256 differs")
        require(path.stat().st_size == p["bytes"], f"{dish} source byte count differs")

    journal = {}
    for path in sorted((root / "outputs").glob("*/*/attempt*/job.json")):
        job = read_json(path)
        job_id = job["job_id"]
        require(isinstance(job_id, str) and job_id.strip() and job_id not in journal, f"bad journal ID at {path}")
        journal[job_id] = (job, path.parent.resolve())
    rejected = read_json(local(root, "outputs/paid-rejections.json"))
    billing = read_json(local(root, "outputs/pricing-check.json"))
    lookups = {k: v for k, v in billing.items() if v.get("http_status") == 403}
    seen_lookups = set()
    seen, rejections = set(), []
    attempts, paid = defaultdict(list), defaultdict(list)
    spend = Decimal(0)
    for index, r in enumerate(rows):
        location = f"results[{index}] {r.get('dish')}/{r.get('provider')} attempt {r.get('attempt')}"
        try:
            dish, provider, host, status = (r[k] for k in ("dish", "provider", "host", "status"))
            if status == "billing_lookup_rejected":
                endpoint = r["endpoint"]
                require(host == "fal" and provider == "fal-account" and dish is None and
                        r["job_id"] is None and r["cost_usd"] == 0 and endpoint in lookups and
                        endpoint not in seen_lookups, "invalid read-only billing event")
                require(all(r.get(k) == v for k, v in lookups[endpoint].items()), "billing lookup evidence differs")
                seen_lookups.add(endpoint)
                continue
            require(dish in photos and provider in HOST and host in {HOST[provider], "huggingface-space"},
                    "unknown dish, provider, or host")
            cost = r["cost_usd"]
            require(number(cost) and cost >= 0, "invalid cost")
            spend += Decimal(str(cost))
            check_paths(root, r.get("paths", {}))
            if r.get("input_mask"):
                local(root, r["input_mask"])
            if status == "submission_rejected":
                require(host == HOST[provider], "unknown rejection host")
                check_rejection(r, report)
                rejections.append(rejection_key(r))
                continue
            job_id = r["job_id"]
            require(job_id in journal and job_id not in seen, "unknown or duplicate accepted job ID")
            seen.add(job_id)
            job, folder = journal[job_id]
            for field in ("dish", "provider", "host", "attempt", "status", "cost_usd"):
                require(r[field] == job[field], f"{field} differs from job journal")
            require(status in {"succeeded", "failed", "canceled", "aborted"}, f"unfinished status {status}")
            if host == "huggingface-space":
                require(cost == 0, "historical public Space job reports a charge")
                continue
            attempt = r["attempt"]
            require(type(attempt) is int and attempt in {1, 2}, "invalid paid attempt")
            attempts[dish, provider].append(attempt)
            paid[dish].append(r)
            if attempt == 2:
                require(isinstance(r["retry_reason"], str) and r["retry_reason"].strip(), "missing retry reason")
            if r.get("source_sha256") is not None:
                require(r["source_sha256"] == photos[dish]["sha256"], "source SHA-256 differs from manifest")
            if status == "succeeded":
                st = r["stats"]
                close(st["app_scale_factor_from_leveled_raw"] * st["raw_robust_width"],
                      photos[dish]["target_width_m"], "application raw scale")
                for name in ("30k", "60k"):
                    tier = st["tiers"][name]
                    close(tier["app_p05_p95_multiplier"] * tier["decoded_robust_width_m"],
                          photos[dish]["target_width_m"], f"{name} application multiplier")
                require(r["paths"]["contact_sheet"] == f"outputs/contact-sheets/{dish}.png", "incorrect dish sheet")
                check_success(root, r, photos[dish], folder)
            else:
                require(r.get("accepted") in (None, False) and r.get("publishable") in (None, False),
                        "failed output marked accepted")
        except (ValueError, TypeError, KeyError, OSError, zipfile.BadZipFile) as exc:
            raise ValueError(f"{location}: {exc}") from exc
    require(seen_lookups == set(lookups), "missing read-only billing lookup")
    require(seen == set(journal), f"{len(set(journal) - seen)} accepted jobs missing from results")
    require(Counter(rejections) == Counter(map(rejection_key, rejected)), "results differ from rejection ledger")
    require(spend <= Decimal("4"), f"total exceeds $4: {spend}")
    for dish in sorted(DISHES):
        for provider in HOST:
            require(sorted(attempts[dish, provider]) in ([1], [1, 2]), f"missing or duplicate attempts: {dish}/{provider}")
        check_sheet(root, dish, photos[dish], paid[dish])
    sheets = root / "outputs/contact-sheets"
    require({p.stem for p in sheets.glob("*.png")} == DISHES, "expected exactly the eight named PNG sheets")
    directory = re.search(r"(?<![\w/-])(?:\./)?outputs/contact-sheets/?(?=[\s`)>.,]|$)", report)
    require(directory or all(f"outputs/contact-sheets/{dish}.png" in report for dish in DISHES),
            "report must reference the sheet directory or all eight sheets")
    print(f"Verified 24 paid dish/provider pairs, {sum(map(len, paid.values()))} paid jobs, "
          f"{len(rejections)} rejected submissions, and eight sheets. Total recorded cost ${spend:.6f}.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=ROOT, help="dish experiment directory (default: beside this script)")
    try:
        verify(parser.parse_args().root.resolve())
    except (ValueError, TypeError, KeyError, OSError, zipfile.BadZipFile) as error:
        sys.exit(f"Verification failed: {error}")
