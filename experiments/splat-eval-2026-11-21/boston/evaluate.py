"""Measure, compress (with the opacity fix) and render each Boston result with the room evaluator's poses."""

import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "rooms"))
import evaluate as rooms  # noqa: E402
from PIL import Image, ImageDraw, ImageFont  # noqa: E402

RESULTS = HERE / "results.json"


TIERS = (100_000, 250_000, 500_000, 1_000_000)


def tier_strip(directory, setup, sogs):
    """One wide pose per tier, so density loss is visible side by side."""
    view = setup["views"][3]
    tiles = []
    for label, sog in sogs:
        path = directory / f"tier-{label}.webp"
        if not path.exists():
            rooms.cli(sog, path, "--camera-pos", ",".join(map(str, view["position"])),
                      "--camera-target", ",".join(map(str, view["target"])), "--camera-up", ",".join(map(str, view["up"])),
                      "--camera-fov", view["vertical_fov_deg"], "--camera-near", view["near"],
                      "--resolution", "640x480", "--background", "0.09,0.09,0.09,1")
        tiles.append((label, Image.open(path).convert("RGB")))
    strip = Image.new("RGB", (640 * len(tiles), 510), "#181a1f")
    draw = ImageDraw.Draw(strip)
    for i, (label, tile) in enumerate(tiles):
        strip.paste(tile, (640 * i, 30))
        draw.text((640 * i + 8, 6), label, fill="white", font=ImageFont.load_default(size=18))
    strip.save(directory / "tiers.png")


def evaluate(row, room):
    directory = HERE / row["directory"]
    ply = directory / "gaussians.ply"
    stats, xyz = rooms.measure(ply)
    raw = stats["raw_gaussians"]
    sogs = []
    for target in TIERS:
        if raw > target:
            sog, stats[f"sog_{target // 1000}k"] = rooms.compress(ply, raw, directory, target)
            sogs.append((f"{target // 1000}k", sog))
    native = directory / "room-native.sog"
    if not native.exists():
        rooms.cli("-g", "cpu", directory / "gaussians-opacity-fixed.ply", native)
    stats["sog_native"] = {"gaussians": raw, "bytes": native.stat().st_size}
    sogs.append((f"native {raw / 1e6:.2f}M", native))
    # Stats go next to the outputs; run.py owns results.json and may be rewriting it.
    (directory / "local-evaluation.json").write_text(json.dumps(stats, indent=2) + "\n")
    camera = json.loads((directory / "camera_params.json").read_text())
    setup = rooms.choose_views(camera, xyz, row["n_photos"], room["reference_height_m_estimate"])
    (directory / "render-poses.json").write_text(json.dumps(setup, indent=2) + "\n")
    # Judge reconstruction at full density; tiers.png shows what compression costs.
    renders = rooms.render(native, directory, setup)
    by_id = {p["id"]: p for p in room["photos"]}
    photos = [{**by_id[i], "path": str(HERE / by_id[i]["path"])} for i in row["photo_ids"][:3]]
    title = f"{row['restaurant']} · {row['n_photos']} photos · {row['resolution']} px · full density"
    rooms.make_sheet(directory / "contact-sheet.png", title, photos, setup, renders)
    tier_strip(directory, setup, sogs)
    print(f"{row['directory']}: {raw:,} raw -> {directory / 'contact-sheet.png'}", flush=True)


if __name__ == "__main__":
    manifest = {r["id"]: r for r in json.loads((HERE / "sources/manifest.json").read_text())}
    rows = json.loads(RESULTS.read_text())
    only = set(sys.argv[1:])
    for row in rows:
        if row["status"] == "succeeded" and (not only or Path(row["directory"]).name in only):
            evaluate(row, manifest[row["room_id"]])
