"""Six-view review sheets: one row per dish (source photo + front/side/top/back/-30/+30), 8 rows per page."""

import json
import sys
from pathlib import Path

from PIL import Image, ImageDraw

HERE = Path(__file__).resolve().parent
OUT = Path(sys.argv[1]) if len(sys.argv) > 1 else HERE / "review"
T, ROWS = 180, 8


def provider_for(p):
    if p["dish"] == "eljefes-burrito":
        return "sam"  # chosen in the first round
    return p["provider"]


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    photos = json.loads((HERE / "sources/manifest.json").read_text())
    rows = []
    for p in photos:
        prov = provider_for(p)
        job = HERE / "outputs" / p["dish"] / prov / "attempt1/job.json"
        r = json.loads(job.read_text()) if job.exists() else {}
        rows.append((p, prov, r))
    for page in range(0, len(rows), ROWS):
        chunk = rows[page:page + ROWS]
        sheet = Image.new("RGB", (190 + 7 * T, len(chunk) * T), "white")
        draw = ImageDraw.Draw(sheet)
        for i, (p, prov, r) in enumerate(chunk):
            y = i * T
            draw.text((4, y + 6), f"{page + i:02d} {p['dish']}\n{prov} {r.get('status', 'missing')}", fill="black")
            src = Image.open(HERE / p["filename"]).convert("RGB")
            src.thumbnail((T, T))
            sheet.paste(src, (190, y))
            for j, k in enumerate(["front", "side", "top", "back", "minus30", "plus30"]):
                view = (r.get("paths") or {}).get("views", {}).get(k)
                if view:
                    sheet.paste(Image.open(HERE / view).convert("RGB").resize((T, T)), (190 + (j + 1) * T, y))
        sheet.save(OUT / f"review-{page // ROWS:02d}.jpg", quality=80)
    print(len(rows), "rows ->", OUT)


if __name__ == "__main__":
    main()
