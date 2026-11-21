"""Fetch and attribute the specifically selected Wikimedia Commons files."""
import argparse
import html
import json
import re
from pathlib import Path
from urllib.parse import quote, urlencode
from urllib.request import Request, urlopen

from PIL import Image, ImageOps

ROOT = Path(__file__).resolve().parent
COMMONS = "https://commons.wikimedia.org"
MANIFEST = ROOT / "sources/manifest.json"
ROOMS = {
    "central": ("Café Central", "Vienna, Austria", "café", [
        ("Cafe Central Wien 2015-i.JPG", "Wide view down the aisle with columns, tiled floor, chairs and the pastry case."),
        ("Café Central Interior 01.jpg", "Cross-aisle view toward the pastry display and windows with shared columns and lamps."),
        ("W00158.jpg", "Additional seating and window bay near the case and columns."),
    ]),
    "chartier": ("Bouillon Chartier Grands Boulevards", "Paris, France", "large dining hall", [
        ("Vue intérieure de Bouillon Chartier Grands Boulevards en août 2023 (2).JPG", "Wide view of the hall down the central tables and aisle."),
        ("Vue intérieure de Bouillon Chartier Grands Boulevards en août 2023.jpg", "View from the right of the central tables with the same globes, skylight and mezzanine."),
        ("Une vue intérieure de Bouillon Chartier Grands Boulevards (août 2023).jpg", "Closer view of the glazed far end, globe lamps and mezzanine railing."),
    ]),
    "mcsorley": ("McSorley's Old Ale House", "New York, NY, USA", "compact pub", [
        ("New York City, 17 May 08 (2502397856).jpg", "Low, wide view showing furniture, sawdust floor, bar and framed wall."),
        ("New York City, 17 May 08 (2501578589).jpg", "More direct view of the bar from a different position, with its framed displays and hanging fixtures."),
        ("New York City, 17 May 08 (2501572821).jpg", "The bar's window-side end and its cabinetry, connecting through the counter and back-bar displays."),
    ]),
}


def fetch(url):
    headers = {
        "User-Agent": "FareSightResearch/1.0 (local experiment with attributed Wikimedia Commons files)",
    }
    with urlopen(Request(url, headers=headers), timeout=25) as response:
        return response.read()


def plain(value):
    return html.unescape(re.sub(r"<[^>]*>", "", value)).strip()


def retrieve(room_id):
    name, location, kind, selections = ROOMS[room_id]
    titles = ["File:" + file for file, _ in selections]
    query = urlencode({
        "action": "query", "format": "json", "titles": "|".join(titles), "prop": "imageinfo",
        "iiprop": "url|extmetadata|size", "iiextmetadatafilter": "Artist|LicenseShortName|LicenseUrl|DateTimeOriginal",
    })
    pages = json.loads(fetch(f"{COMMONS}/w/api.php?{query}"))["query"]["pages"]
    metadata = {page["title"]: page["imageinfo"][0] for page in pages.values()}
    directory = ROOT / "sources" / room_id
    directory.mkdir(exist_ok=True)
    photos = []
    for i, (title, (_, selection)) in enumerate(zip(titles, selections), 1):
        info = metadata[title]
        ext = {key: plain(value["value"]) for key, value in info["extmetadata"].items()}
        original = info["url"].split("?")[0]
        download = f"{COMMONS}/wiki/Special:FilePath/{quote(title[5:].replace(' ', '_'))}?width=1280"
        path = directory / f"{i:02}.jpg"
        downloaded = directory / f"{i:02}-original.jpg"
        if not downloaded.exists():
            downloaded.write_bytes(fetch(download))
        with Image.open(downloaded) as original_image:
            image = ImageOps.exif_transpose(original_image).convert("RGB")
            # WorldMirror stacks inputs into one tensor and requires matching processed dimensions.
            ImageOps.fit(image, (1280, 960), Image.Resampling.LANCZOS).save(path, quality=94)
        with Image.open(path) as image:
            size = list(image.size)
            image.thumbnail((330, 220), Image.Resampling.LANCZOS)
            thumb = directory / f"{i:02}-thumb.jpg"
            image.save(thumb, quality=88)
        photos.append({
            "n": i, "filename": title[5:], "source_url": info["descriptionurl"], "original_url": original,
            "download_url": download, "author": ext["Artist"], "license": ext["LicenseShortName"],
            "license_url": ext.get("LicenseUrl"), "capture_date": ext.get("DateTimeOriginal"),
            "path": str(path.relative_to(ROOT)), "thumbnail": str(thumb.relative_to(ROOT)),
            "size": size, "downloaded_copy": str(downloaded.relative_to(ROOT)), "selection": selection,
        })
        print(f"{name} #{i}: {size}, {ext['Artist']}, {ext['LicenseShortName']}", flush=True)
    return {
        "id": room_id, "restaurant": name, "location": location, "type": kind,
        "reference_height_m_estimate": 1.10 if room_id == "mcsorley" else 1.55,
        "photos": photos,
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("rooms", nargs="+", choices=ROOMS)
    args = parser.parse_args()
    manifest = {r["id"]: r for r in json.loads(MANIFEST.read_text())} if MANIFEST.exists() else {}
    for room in args.rooms:
        manifest[room] = retrieve(room)
        MANIFEST.write_text(json.dumps(list(manifest.values()), indent=2, ensure_ascii=False) + "\n")
