"""Build sources/manifest.json for the expanded restaurant menus.

Every entry: dish slug, venue, menu name, cropped input JPEG (+sha256), nominal width (metres),
provider (SAM for clean product shots, Idol for restaurant food photos), SAM prompt, source URL,
listed price where the restaurant publishes one (Shu Daxia's Chowbus online-ordering menu), else null.
All photos are the restaurants' own marketing images: demo use only.
"""

import hashlib
import json
import re
from pathlib import Path

from PIL import Image

HERE = Path(__file__).resolve().parent
WEB = HERE / "sources/web"
INPUTS = HERE / "sources/inputs"
LICENSE = "Restaurant marketing photo, copyright the restaurant. Demo use only, not for public release."


def slug(text):
    return re.sub(r"[^a-z0-9]+", "-", text.lower().replace("&", "and")).strip("-")[:40]


def save_input(dish, src, crop=None):
    im = Image.open(src)
    im.load()
    im = im.convert("RGB")
    if crop:
        im = im.crop(tuple(crop))
    im.thumbnail((1600, 1600))
    out = INPUTS / f"{dish}.jpg"
    im.save(out, quality=94)
    return str(out.relative_to(HERE)), hashlib.sha256(out.read_bytes()).hexdigest()


def entry(dish, venue, name, src, url, width, provider, prompt, price=None, price_source=None, crop=None):
    filename, sha = save_input(dish, src, crop)
    return dict(dish=dish, venue_id=venue, name=name, filename=filename, sha256=sha, target_width_m=width,
                provider=provider, prompt=prompt, source_url=url, license=LICENSE,
                listed_price_usd=price, price_source=price_source)


def main():
    INPUTS.mkdir(parents=True, exist_ok=True)
    out = []
    ej = {l.split()[0]: l.split()[1] for l in (WEB / "eljefes/index.txt").read_text().splitlines()}

    # El Jefe's Taqueria: photos from eljefestaqueria.com/menu (no prices published; ordering site blocks automated access).
    for d, name, f, w, prompt in [
        ("eljefes-tacos", "Tacos (three)", "15.jpg", 0.22, "three tacos"),
        ("eljefes-burrito", "Carnitas burrito", "05.png", 0.22, "burrito cut in half"),
        ("eljefes-bowl", "Burrito bowl", "04.webp", 0.24, "bowl of rice and meat"),
        ("eljefes-chips-dips", "Chips with guacamole, queso and salsa", "02.webp", 0.32, "chips and dips"),
        ("eljefes-churros", "Churros with chocolate sauce", "06.png", 0.28, "churros"),
        ("eljefes-quesadilla", "Quesadilla", "09.webp", 0.26, "quesadilla"),
        ("eljefes-taco-salad", "Taco salad bowl", "10.webp", 0.24, "taco salad in a tortilla bowl"),
        ("eljefes-salsas", "Salsas and sides", "16.webp", 0.24, "cups of salsa"),
    ]:
        out.append(entry(d, "kenmore-jefes-01", f"El Jefe's {name}", WEB / "eljefes" / f, ej[f], w, "idol", prompt))

    # Shu Daxia: Chowbus online-ordering menu (pos.chowbus.com/online-ordering/store/11441), item photo + listed price.
    items = {i["name"]: i for i in json.loads((WEB / "shudaxia-chowbus/selected.json").read_text())}
    chowbus = "Chowbus online-ordering menu (pos.chowbus.com/online-ordering/store/11441)"
    sdx = [
        ("shudaxia-hotpot", "taiji shrimp paste2.0 (shu da xia special shrimp paste)", 0.32),
        ("shudaxia-beef", "premium fatty beef slice", 0.26),
        ("shudaxia-pork-ribs", "signature pork ribs w. warriors spicy sauce", 0.24),
        ("shudaxia-beef-tripe", "signature beef tripe", 0.24),
        ("shudaxia-beef-skewers", "warriors select beef skewers", 0.12),
        ("shudaxia-beef-tongue", "beef tongue", 0.26),
        ("shudaxia-ribeye", "prime ribeye slice", 0.26),
        ("shudaxia-lamb", "lamb slice", 0.28),
        ("shudaxia-beef-duo", "beef duo(ribeye & bonless short rib)", 0.28),
        ("shudaxia-short-rib", "boneless short rib", 0.28),
        ("shudaxia-marinated-beef", "prime marinated beef slices", 0.26),
        ("shudaxia-shrimp", "white shrimp w/ head", 0.26),
        ("shudaxia-frog-leg", "frog leg", 0.26),
        ("shudaxia-abalone", "abalone(new)", 0.20),
        ("shudaxia-fish-fillets", "kung fu snakehead fish fillets", 0.26),
        ("shudaxia-shrimp-roll", "tiger shrimp paste beancurd roll (*new*)", 0.22),
        ("shudaxia-veg-platter", "vegetable platter", 0.22),
        ("shudaxia-mushroom-platter", "assorted mushroom platter", 0.26),
        ("shudaxia-crispy-pork", "crispy fried pork", 0.22),
        ("shudaxia-sticky-rice", "fried sticky rice w. brown sugar", 0.24),
        ("shudaxia-sichuan-fries", "sichuan style french fries", 0.24),
        ("shudaxia-dumplings", "mini pork and cabbage dumplings (10pcs)", 0.22),
        ("shudaxia-beef-fried-rice", "beef fried rice", 0.26),
        ("shudaxia-noodles", "hand-pulled noodles", 0.22),
        ("shudaxia-malatang", "malatang", 0.24),
        ("shudaxia-ice-pudding", "brown sugar ice pudding(seasonal fruits)gf", 0.20),
        ("shudaxia-tofu-pudding", "tofu pudding (limited everyday)gf", 0.08),
        ("shudaxia-crepe-cake", "vanilla crepe cake(not gf)", 0.22),
        ("shudaxia-cheesecake", "key lime cheesecake(not gf)", 0.18),
        ("shudaxia-strawberry-matcha", "strawberry matcha latte", 0.09),
        ("shudaxia-mango-tea", "mango iced lemon tea", 0.09),
        ("shudaxia-lime-tea", "hand beaten iced lime tea", 0.09),
    ]
    for d, key, w in sdx:
        it = items[key]
        name = re.sub(r"\s*\((not )?gf\)|gf$|\(new\)|\(\*new\*\)", "", it["name"]).strip()
        out.append(entry(d, "kenmore-shudaxia-01", f"Shu Daxia {name}", WEB / "shudaxia-chowbus" / it["file"],
                         it["image_url"], w, "idol", name, it["price"], chowbus))

    # Starbucks: official product images (starbucks.com menu feed); prices vary by store, none published.
    widths = {"drink_hot": 0.09, "drink_iced": 0.095, "sandwich": 0.12, "small": 0.09}
    kinds = {"Bacon, Gouda & Egg Sandwich": "sandwich", "Sausage, Cheddar & Egg Sandwich": "sandwich",
             "Impossible™ Breakfast Sandwich": "sandwich", "Turkey Bacon, Cheddar & Egg White Sandwich": "sandwich",
             "Spinach, Feta & Egg White Wrap": 0.16, "Bacon & Gruyère Egg Bites": 0.10, "Birthday Cake Pop": 0.045,
             "Chocolate Croissant": 0.15, "Cheese Danish": 0.11, "Iced Lemon Loaf": 0.10, "Chocolate Chip Cookie": "small",
             "Plain Bagel": 0.10, "Blueberry Streusel Muffin": "small", "Banana, Walnut & Pecan Loaf": 0.10}
    prompts = {"sandwich": "sandwich", 0.16: "wrap", 0.10: "food", 0.045: "cake pop", 0.15: "croissant", 0.11: "pastry",
               "small": "baked good"}
    out.append(entry("starbucks-drink", "bu-starbucks-01", "Starbucks Iced Caramel Macchiato",
                     WEB / "starbucks/IcedCaramelMacchiato.png", "https://cloudassets.starbucks.com/is/image/sbuxcorp/IcedCaramelMacchiato",
                     0.095, "sam", "iced coffee in a clear cup", crop=[423, 374, 1035, 1266]))
    out.append(entry("starbucks-pastry", "bu-starbucks-01", "Starbucks Butter Croissant",
                     WEB / "starbucks/SBX20210915_Croissant-onGreen.png", "https://cloudassets.starbucks.com/is/image/sbuxcorp/SBX20210915_Croissant-onGreen",
                     0.16, "sam", "croissant", crop=[374, 474, 1056, 955]))
    for it in json.loads((WEB / "starbucks/lineup.json").read_text()):
        name = it["name"].replace("®", "").replace("™", "")
        kind = kinds.get(it["name"])
        if kind is None:
            iced = (it.get("form") == "Iced") or any(k in name for k in ("Iced", "Cold", "Refresher", "Pink", "Frappuccino"))
            kind = "drink_iced" if iced else "drink_hot"
            prompt = "drink in a clear plastic cup" if iced else "coffee cup"
        else:
            prompt = prompts.get(kind, "food")
        width = widths.get(kind, kind) if isinstance(kind, str) else kind
        out.append(entry(f"starbucks-{slug(name)}", "bu-starbucks-01", f"Starbucks {name}", WEB / "starbucks" / Path(it["file"]).relative_to("."),
                         it["image"], width, "sam", prompt, crop=it["crop_px"]))
    (HERE / "sources/manifest.json").write_text(json.dumps(out, indent=2, ensure_ascii=False) + "\n")
    print(len(out), "dishes:", {v: sum(e["venue_id"] == v for e in out) for v in {e["venue_id"] for e in out}})


if __name__ == "__main__":
    main()
