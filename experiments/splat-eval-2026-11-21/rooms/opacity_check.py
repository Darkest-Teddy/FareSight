"""Controlled re-render: does fixing WorldMirror's opacity convention, or keeping more Gaussians, rescue a room?

WorldMirror writes activated opacity (0-1) into the PLY `opacity` field. SplatTransform, like every
standard 3DGS reader, treats that field as a logit and applies a sigmoid, which squeezes every Gaussian
into 50-73% opacity. This script writes logit-encoded copies, then renders the original 100k, the original
at native density, and the fixed file at native, 250k and 100k from the scored camera poses. It also
renders the moved views at photo 1's field of view, so field of view and movement are not confounded.

No inference is run. Outputs go to outputs/opacity-check/<config>/.
"""

import argparse
import json
import zipfile

import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageOps

from evaluate import SHEET_FONTS, cli, fix_opacity, read_ply
from run import ROOT


def to_sog(ply, sog, target=None):
    if sog.exists():
        return
    if target:
        decimated = sog.with_suffix(".decimated.ply")
        if not decimated.exists():
            cli("-g", "cpu", ply, "--decimate", target, decimated)
        ply = decimated
    cli("-g", "cpu", ply, sog)


def count(sog):
    with zipfile.ZipFile(sog) as archive:
        return json.loads(archive.read("meta.json"))["count"]


def render(sog, path, view, fov=None):
    def csv(values):
        return ",".join(f"{v:.8g}" for v in values)

    if not path.exists():
        cli(sog, path, "--camera-pos", csv(view["position"]), "--camera-target", csv(view["target"]),
            "--camera-up", csv(view["up"]), "--camera-fov", fov or view["vertical_fov_deg"],
            "--camera-near", view["near"], "--resolution", "x".join(map(str, view["pixels"])),
            "--background", "0.09,0.09,0.09,1")
    return path


def sheet(path, title, rows, views):
    w, h, gap, head, label_w = 300, 225, 8, 70, 210
    image = Image.new("RGB", (label_w + len(views) * (w + gap) + gap, head + len(rows) * (h + gap)), "#181a1f")
    draw = ImageDraw.Draw(image)
    family = next((p for p in SHEET_FONTS if p.exists()), None)
    font = lambda size: ImageFont.truetype(str(family), size) if family else ImageFont.load_default(size=size)
    draw.text((gap, 10), title, font=font(22), fill="white")
    for i, view in enumerate(views):
        text = view["label"] + (f" · {view['translation_from_photo_1_m_estimate']:.2f} m" if i else "")
        draw.text((label_w + i * (w + gap), 44), text, font=font(13), fill="#d7dae0")
    for r, (label, renders) in enumerate(rows):
        y = head + r * (h + gap)
        draw.multiline_text((gap, y + 8), label, font=font(14), fill="#d7dae0", spacing=4)
        for i, render_path in enumerate(renders):
            if render_path is None:
                continue
            with Image.open(render_path) as tile:
                panel = ImageOps.fit(tile.convert("RGB"), (w, h))
            image.paste(panel, (label_w + i * (w + gap), y))
    image.save(path)


def check(config):
    source = ROOT / "outputs" / config
    out = ROOT / "outputs/opacity-check" / config
    out.mkdir(parents=True, exist_ok=True)
    setup = json.loads((source / "render-poses.json").read_text())
    views = setup["views"]
    photo_fov = views[0]["vertical_fov_deg"]

    raw = source / "gaussians.ply"
    fixed = out / "gaussians-opacity-fixed.ply"
    if not fixed.exists():
        fix_opacity(raw, fixed)
    native = len(read_ply(raw))

    variants = [("orig-100k", "Original · 100k\n(what was scored)", source / "room-100000.sog")]
    to_sog(raw, out / "orig-native.sog")
    variants.append(("orig-native", f"Original · native\n{native:,}", out / "orig-native.sog"))
    to_sog(fixed, out / "fixed-native.sog")
    variants.append(("fixed-native", f"Opacity fixed · native\n{native:,}", out / "fixed-native.sog"))
    for target in (250_000, 100_000):
        if native > target:
            sog = out / f"fixed-{target // 1000}k.sog"
            to_sog(fixed, sog, target)
            variants.append((f"fixed-{target // 1000}k", f"Opacity fixed · {target // 1000}k", sog))

    rows = []
    for key, label, sog in variants:
        rows.append((label, [render(sog, out / f"{key}-{v['id']}.webp", v) for v in views]))
    fixed_native = out / "fixed-native.sog"
    rows.append((f"Opacity fixed · native\nphoto-1 FOV ({photo_fov:.0f}°)",
                 [None] + [render(fixed_native, out / f"fixed-native-{v['id']}-photofov.webp", v, photo_fov)
                           for v in views[1:]]))
    sheet(out / "comparison.png", f"{config} · opacity and density check", rows, views)
    print(out / "comparison.png", {k: count(s) for k, _, s in variants}, flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("configs", nargs="*", default=["mcsorley-2p-518", "central-2p-518", "chartier-2p-518"])
    for config in parser.parse_args().configs:
        check(config)
