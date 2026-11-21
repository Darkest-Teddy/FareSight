"""Assemble paid three-provider sheets and retain separate historical records."""
import hashlib, json
from PIL import Image, ImageDraw, ImageOps
from evaluate import ROOT,OUT,draw_text,VIEWS,ELEVATIONS
from run import jobs,save

TITLES={'ramen':'Shoyu ramen','curry':'Katsu curry','tiramisu':'Tiramisu','burger':'Burger and fries','cocktail':'Old fashioned','pizza':'Margherita pizza','sushi':'Salmon sushi platter','salad':'Greek salad'}
PROVIDERS={'sam':'SAM 3D Objects','idol':'Idol','trellis':'TRELLIS'}
def place(canvas,path,box):
    x,y,w,h=box
    with Image.open(path) as image:
        im=ImageOps.contain(ImageOps.exif_transpose(image).convert('RGB'),(w,h))
        canvas.paste(im,(x+(w-im.width)//2,y+(h-im.height)//2))

def chosen_attempt(records,slug,provider):
    matches=[r for r in records if r['dish']==slug and r['provider']==provider and r['host'] in ('replicate','fal') and r['status']=='succeeded']
    return max(matches,key=lambda r:(r.get('publishable') is True,r['attempt'])) if matches else None

def main():
    photos=json.loads((ROOT/'sources/manifest.json').read_text())
    rejected=OUT/'paid-rejections.json'
    records=jobs()+(json.loads(rejected.read_text()) if rejected.exists() else [])
    snapshots=OUT/'fal-response-billing.json'
    observations=json.loads(snapshots.read_text()) if snapshots.exists() else {}
    digests={p['dish']:p['sha256'] for p in photos}
    for record in records:
        if record.get('job_id') and record['host'] in ('fal','replicate'):
            record['source_sha256']=digests[record['dish']]
            if record.get('input_mask'):
                record['mask_sha256']=hashlib.sha256((ROOT/record['input_mask']).read_bytes()).hexdigest()
        stats=record.get('stats')
        if stats and stats.get('raw_robust_width') and record['host'] in ('fal','replicate'):
            stats['app_scale_factor_from_leveled_raw']=stats['target_width_m']/stats['raw_robust_width']
            for tier in stats['tiers'].values():
                tier['app_p05_p95_multiplier']=stats['target_width_m']/tier['decoded_robust_width_m']
        if record.get('job_id') in observations:
            record['billing']['queue_observations']=observations[record['job_id']]
    pricing=OUT/'pricing-check.json'
    if pricing.exists():
        for endpoint,detail in json.loads(pricing.read_text()).items():
            if detail.get('http_status')==403:
                records.append(dict(host='fal', provider='fal-account', dish=None, attempt=None, job_id=None,
                                    status='billing_lookup_rejected', endpoint=endpoint, runtime_s=None,
                                    cost_usd=0, paths={}, stats=None, scores=None, publishable=None, **detail))
    directory=OUT/'contact-sheets';directory.mkdir(exist_ok=True)
    for photo in photos:
        slug=photo['dish']
        sheet=Image.new('RGB',(1980,940),'#fafaf8');draw=ImageDraw.Draw(sheet)
        draw_text(draw,(18,12),TITLES[slug],34)
        draw_text(draw,(18,61),f"Reference · {photo['target_width_m']*100:g} cm",19)
        place(sheet,ROOT/photo['filename'],(18,98,270,600))
        draw_text(draw,(18,723),photo['author'].split(' from ')[0].split(' (')[0][:30],15)
        draw_text(draw,(18,748),photo['license'],15)
        labels=['Photo angle','Side','Top','Back','−30°','+30°','Photo angle · 30k']
        for i,label in enumerate(labels):draw_text(draw,(305+i*239,57),label,18)
        for idx,(provider,name) in enumerate(PROVIDERS.items()):
            y=117+idx*278
            job=chosen_attempt(records,slug,provider)
            available=job and job['paths'].get('views')
            text=f"{name} · 60k SOG" if available else f"{name} · no paid output"
            if available and job.get('publishable') is not None:
                text+= ' · accepted' if job['publishable'] else ' · rejected'
            draw_text(draw,(305,y-30),text,20)
            if not available:
                draw.rectangle((305,y,1967,y+224),fill='#e9eceb')
                draw_text(draw,(328,y+95),'Unavailable',20)
                continue
            paths=job['paths'];tiles=[paths['views'][v] for v in VIEWS]+[paths['front30k']]
            for i,path in enumerate(tiles):
                x=305+i*239
                with Image.open(ROOT/path) as im:color=im.convert('RGB').getpixel((0,0))
                draw.rectangle((x,y,x+231,y+224),fill=color)
                place(sheet,ROOT/path,(x,y,232,225))
        path=directory/(slug+'.png');sheet.save(path)
        for r in records:
            if r['dish']!=slug:continue
            if r['host']=='huggingface-space':
                if r['status']=='succeeded':r['paths']['contact_sheet']='outputs/ramen/idol-space/attempt1/historical-sheet.png'
                else:r['paths'].pop('contact_sheet',None)
            else:r['paths']['contact_sheet']=str(path.relative_to(ROOT))
    save(ROOT/'results.json',records)
if __name__=='__main__':main()
