"""Real menu items from the three Atlas-room restaurants, through the dish experiment's pipeline.

Reuses ../dishes (fal SAM 3D Objects and Idol runners, levelling, normalisation, SOG tiers) with this
folder as its root, so the jobs, budget ledger and outputs stay separate from the experiment.

  python3 pipeline.py run sam|idol [dish]           submit or resume one job per dish
  python3 pipeline.py orbit sam|idol [dish]         normalise + 8-view orbit sheet for orientation review
  python3 pipeline.py final <provider> <dish> <azimuth> [level-method]   export the reviewed result
  python3 pipeline.py batch <venue-prefix>         run + final for every dish of a venue with its manifest
                                                   provider (Idol: camera azimuth; SAM: azimuth 0, metadata level)
"""

import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "dishes"))
import run as R  # noqa: E402
import evaluate as E  # noqa: E402
from level_sam import level as level_of  # noqa: E402

R.ROOT, R.OUT = HERE, HERE / "outputs"
E.ROOT, E.OUT = HERE, HERE / "outputs"
R.LIMIT = 8.0  # USD cap for this folder (initial 6 dishes + expanded menus)
R.OUT.mkdir(exist_ok=True)
PHOTOS = json.loads((HERE / "sources/manifest.json").read_text())
E.ELEVATIONS.update({p["dish"]: (12 if p["target_width_m"] <= 0.1 and "starbucks" in p["dish"] else 35) for p in PHOTOS})
E.ELEVATIONS.update({"eljefes-tacos": 35, "eljefes-burrito": 30, "shudaxia-hotpot": 55, "shudaxia-beef": 30,
                     "starbucks-drink": 12, "starbucks-pastry": 30})


def photos(only=None):
    return [p for p in PHOTOS if not only or p["dish"] == only]


def journal(provider, dish, attempt=1):
    return R.OUT / dish / provider / f"attempt{attempt}" / "job.json"


if __name__ == "__main__":
    cmd, provider = sys.argv[1], sys.argv[2]
    rest = sys.argv[3:]
    if cmd == "batch":
        import math
        for p in [p for p in PHOTOS if p["dish"].startswith(provider)]:
            prov, j = p["provider"], journal(p["provider"], p["dish"])
            try:
                if not j.exists() or json.loads(j.read_text())["status"] not in ("succeeded", "failed"):
                    R.run(prov, p, 1, None, None, p["prompt"] if prov == "sam" else None)
                r = json.loads(j.read_text())
                if r["status"] != "succeeded" or r["paths"].get("views"):
                    continue
                if prov == "idol":
                    E.process(j, p, (-math.degrees(r["camera"]["yaw"])) % 360, (0, 0, 0))
                else:
                    E.process(j, p, 0.0, level_of(j.parent, r, "metadata"))
            except Exception as error:  # keep the batch going; the review step sees what is missing
                print("ERROR", p["dish"], prov, str(error)[:300], flush=True)
    elif cmd == "run":
        for p in photos(rest[0] if rest else None):
            R.run(provider, p, 1, None, None, p["prompt"] if provider == "sam" else None)
    elif cmd == "orbit":
        for p in photos(rest[0] if rest else None):
            j = journal(provider, p["dish"])
            if not j.exists() or json.loads(j.read_text())["status"] != "succeeded":
                print("skip", p["dish"], provider)
                continue
            r = json.loads(j.read_text())
            lvl = level_of(j.parent, r, "metadata") if provider == "sam" else (0, 0, 0)
            E.process(j, p, None, lvl)
    elif cmd == "final":
        dish, azimuth = rest[0], rest[1]
        method = rest[2] if len(rest) > 2 else "metadata"
        p = photos(dish)[0]
        j = journal(provider, dish)
        r = json.loads(j.read_text())
        if azimuth == "camera":
            import math
            azimuth = (-math.degrees(r["camera"]["yaw"])) % 360
        lvl = level_of(j.parent, r, method) if (provider == "sam" or method != "metadata") else (0, 0, 0)
        E.process(j, p, float(azimuth), lvl)
        r = json.loads(j.read_text())
        r["prep_method"] = method
        R.save(j, r)
