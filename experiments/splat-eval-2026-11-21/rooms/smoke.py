"""Exercise local evaluation with a synthetic room, outside the paid ledger."""
import numpy as np
from PIL import Image

from evaluate import evaluate
from run import ROOT, write_json

directory = ROOT / "outputs" / "smoke"
directory.mkdir(parents=True, exist_ok=True)
rng = np.random.default_rng(12345)
count = 140_000
rows = np.zeros((count, 17), dtype="<f4")
xyz = rows[:, :3]
xyz[:, 0] = rng.uniform(-2.5, 2.5, count)
xyz[:, 1] = rng.uniform(-1.3, 1.55, count)
xyz[:, 2] = rng.uniform(1.15, 7.0, count)
floor = np.arange(count) < count // 3
wall = np.arange(count) >= count * 2 // 3
xyz[floor, 1] = 1.55
xyz[wall, 2] = 6.8
xyz[~(floor | wall), 0] = rng.choice([-2.5, 2.5], count - int(floor.sum()) - int(wall.sum()))
colors = np.select([floor[:, None], wall[:, None]], [[0.65, 0.3, 0.25], [0.3, 0.75, 0.4]], [0.25, 0.5, 0.9])
rows[:, 6:9] = (colors - .5) / .28209479177387814
rows[:, 9] = 2.4
rows[:, 10:13] = -3.8
rows[:, 13] = 1
properties = ("x y z nx ny nz f_dc_0 f_dc_1 f_dc_2 opacity scale_0 scale_1 scale_2 "
              "rot_0 rot_1 rot_2 rot_3").split()
ply = directory / "gaussians.ply"
header = "\n".join(["ply", "format binary_little_endian 1.0", f"element vertex {count}"] +
                   [f"property float {p}" for p in properties] + ["end_header", ""])
with ply.open("wb") as file:
    file.write(header.encode())
    rows.tofile(file)
camera = directory / "camera_params.json"
pose = np.eye(4)
shifted = pose.copy()
shifted[0, 3] = .25
k = [[600, 0, 400], [0, 600, 300], [0, 0, 1]]
write_json(camera, {
    "extrinsics": [{"camera_id": i, "matrix": mat.tolist()} for i, mat in enumerate([pose, shifted])],
    "intrinsics": [{"camera_id": i, "matrix": k} for i in range(2)],
})
fixture_source = directory / "synthetic-source.jpg"
Image.new("RGB", (800, 600), "#346789").save(fixture_source)
relative = str(directory.relative_to(ROOT))
row = {
    "directory": relative, "restaurant": "Synthetic smoke fixture", "n_photos": 2, "resolution": 518,
    "output_paths": {"raw_ply": f"{relative}/{ply.name}", "camera_params": f"{relative}/{camera.name}"},
}
photo = {"path": str(fixture_source.relative_to(ROOT)), "author": "Synthetic test pattern", "license": "Fixture"}
evaluate(row, {"photos": [photo, photo]}, with_250k=True)
assert row["stats"]["raw_gaussians"] == count
assert row["stats"]["sog_100k"]["gaussians"] == 100_000
assert row["stats"]["sog_250k"]["gaussians"] == count
assert len(row["output_paths"]["renders"]) == 5
for name in row["output_paths"]["renders"]:
    with Image.open(ROOT / name) as image:
        assert np.std(np.asarray(image.convert("RGB"))) > 5, f"{name} is blank"
assert (ROOT / row["output_paths"]["contact_sheet"]).exists()
write_json(directory / "smoke-result.json", row)
print("Smoke verified 140,000 raw → 100,000 SOG, 250,000 ceiling, five nonblank renders, and contact sheet.")
