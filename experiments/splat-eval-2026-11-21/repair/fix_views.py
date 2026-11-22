"""Clean rendered views with NVIDIA Difix (difix_ref, research/evaluation licence), guided by the nearest real photo.

Run with repair/venv: venv/bin/python fix_views.py views/<config>/jobs.json
"""

import json
import os
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
os.environ.setdefault("HF_HOME", str(HERE / "hf-cache"))
sys.path.insert(0, str(HERE / "vendor/Difix3D/src"))

import torch  # noqa: E402
from PIL import Image, ImageOps  # noqa: E402
from pipeline_difix import DifixPipeline  # noqa: E402


def main(jobs_path):
    jobs = json.loads(Path(jobs_path).read_text())
    device = "mps" if torch.backends.mps.is_available() else "cpu"
    pipe = DifixPipeline.from_pretrained("nvidia/difix_ref", trust_remote_code=True).to(device)
    pipe.set_progress_bar_config(disable=True)
    for job in jobs:
        if Path(job["fixed"]).exists():
            continue
        image = Image.open(job["render"]).convert("RGB")
        ref = ImageOps.fit(Image.open(job["ref"]).convert("RGB"), image.size)
        start = time.time()
        out = pipe("remove degradation", image=image, ref_image=ref, num_inference_steps=1, timesteps=[199],
                   guidance_scale=0.0, height=image.height, width=image.width).images[0]
        out.save(job["fixed"])
        print(f"{job['name']}: {time.time() - start:.1f}s", flush=True)


if __name__ == "__main__":
    main(sys.argv[1])
