"""Fetch the chosen Commons JPEGs and record their attribution and digest."""
from pathlib import Path
import hashlib, html, json, re, time
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from urllib.error import HTTPError
from PIL import Image

ROOT = Path(__file__).resolve().parent
PHOTOS = [
    ('ramen', 'Shoyu Ramen（Tokyo Ramen） - 01.jpg', .24),
    ('curry', 'Katsu-curry 002.jpg', .26),
    ('tiramisu', 'Tiramisu - Raffaele Diomede.jpg', .18),
    ('burger', 'RedDot Burger.jpg', .15),
    ('cocktail', 'Whiskey Old Fashioned1.jpg', .085),
    ('pizza', 'PizzaMargarita.jpg', .30),
    ('sushi', 'Salmon Sushi and Sashimi Platter - W Sushi.jpg', .26),
    ('salad', 'Greek salad.jpg', .24),
]

def fetch(url):
    for attempt in range(4):
        try:
            with urlopen(Request(url, headers={'User-Agent': 'FareSight-DishResearch/1.0 (Commons attribution)'}), timeout=45) as response:
                return response.read()
        except HTTPError as error:
            if error.code not in (429, 502, 503) or attempt == 3:
                raise
            time.sleep(2 ** attempt)

def main():
    cached = ROOT / 'sources/manifest.json'
    if cached.exists():
        manifest = json.loads(cached.read_text())
        if [(p['dish'],p['title'],p['target_width_m']) for p in manifest] == PHOTOS and all(
            (ROOT/p['filename']).exists() and hashlib.sha256((ROOT/p['filename']).read_bytes()).hexdigest()==p['sha256'] for p in manifest
        ):
            print('Verified archived source digests')
            return
    manifest = []
    for slug, name, width in PHOTOS:
        query = urlencode(dict(action='query', titles='File:' + name, prop='imageinfo', iiprop='url|extmetadata', format='json'))
        if slug == 'curry':
            key = name.replace(' ', '_')
            h = hashlib.md5(key.encode()).hexdigest()
            info = dict(url=f'https://upload.wikimedia.org/wikipedia/commons/{h[0]}/{h[:2]}/{key}', descriptionurl=f'https://commons.wikimedia.org/wiki/File:{key}', extmetadata={k:{'value':v} for k,v in dict(Artist='Ocdp', LicenseShortName='CC0 1.0',LicenseUrl='https://creativecommons.org/publicdomain/zero/1.0/').items()})
        else:
            page = next(iter(json.loads(fetch('https://commons.wikimedia.org/w/api.php?' + query))['query']['pages'].values()))
            info = page['imageinfo'][0]
        meta = info['extmetadata']
        value = lambda key: html.unescape(re.sub('<[^>]*>', '', meta.get(key, {}).get('value', ''))).strip()
        url = info['url'].split('?')[0]
        path = ROOT / 'sources' / (slug + '.jpg')
        if slug != 'ramen':
            from urllib.parse import quote
            key = name.replace(' ', '_')
            h = hashlib.md5(key.encode()).hexdigest()
            resolution = 960 if slug == 'salad' else 1280
            url = f'https://thumb.wikimedia.org/wikipedia/commons/thumb/{h[0]}/{h[:2]}/{quote(key)}/{resolution}px-{quote(key)}'
        if not path.exists():
            path.write_bytes(fetch(url))
        with Image.open(path) as im:
            size = list(im.size)
        manifest.append(dict(dish=slug, filename=str(path.relative_to(ROOT)), title=name, url=url, page=info['descriptionurl'],
                             author=value('Artist'), license=value('LicenseShortName'), license_url=value('LicenseUrl'),
                             dimensions=size, bytes=path.stat().st_size, sha256=hashlib.sha256(path.read_bytes()).hexdigest(), target_width_m=width))
        print(slug, size, path.stat().st_size, value('LicenseShortName'), flush=True)
    (ROOT / 'sources/manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')

if __name__ == '__main__':
    main()
