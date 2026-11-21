"""Run missing provider jobs sequentially. Resume saved IDs without resubmitting."""
import argparse, base64, fcntl, hashlib, json, math, os, re, shutil, time
from datetime import datetime, timezone
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parent
OUT = ROOT / 'outputs'
VERSION = 'e8f6c45206993f297372f5436b90350817bd9b4a0d52d2a76df50c1c8afa2b3c'
REP = 'https://api.replicate.com/v1/predictions'
def utc_now():
    return datetime.now(timezone.utc).isoformat(timespec='milliseconds')

FAL = {'idol':'speridlabs/idol','sam':'fal-ai/sam-3/3d-objects'}
PROMPTS={'ramen':'bowl of ramen', 'curry':'plate of curry rice', 'tiramisu':'plate of tiramisu', 'burger':'burger and fries', 'cocktail':'cocktail glass', 'pizza':'plate of pizza', 'sushi':'platter of sushi', 'salad':'bowl of Greek salad'}
RATE = .0014
LIMIT = 4.0

def key(name):
    for line in (ROOT.parents[2] / '.env').read_text().splitlines():
        m = re.match(r'(?:export\s+)?'+name+r'\s*=\s*(.*)', line.strip())
        if m:
            return m[1].strip().strip('"\'')
    return ''

def save(path, obj):
    tmp = path.with_suffix('.part')
    tmp.write_text(json.dumps(obj, indent=2, ensure_ascii=False) + '\n')
    tmp.replace(path)

def api(url, headers, payload=None, response_headers=None):
    data = None if payload is None else json.dumps(payload).encode()
    req = Request(url, data, {'Content-Type':'application/json', 'User-Agent':'FareSight-Splat-Eval/1.0', **headers})
    for i in range(4):
        try:
            with urlopen(req, timeout=90) as response:
                if response_headers is not None:
                    response_headers.update({k.lower():v for k,v in response.headers.items() if any(w in k.lower() for w in ("bill","price","cost","inference"))})
                return json.load(response)
        except HTTPError as e:
            if e.code==429 and i<3:
                wait=e.headers.get('Retry-After')
                try:
                    detail=json.loads(e.read())
                    delay=math.ceil(float(wait or detail.get('retry_after',10)))+1
                except (ValueError,TypeError):
                    delay=11
                time.sleep(min(60,max(1,delay)))
                continue
            if data is not None or e.code not in (429,500,502,503,504) or i == 3:
                detail = e.read().decode(errors='replace')
                for header in headers.get('Authorization','').split()[1:]:
                    detail=detail.replace(header,'[redacted]')
                if e.code!=403:
                    detail=detail[:2000]
                raise RuntimeError(f'HTTP {e.code} from {url.split("?")[0]}: {detail}') from None
            time.sleep(2**i)

def download(url, path):
    for i in range(4):
        try:
            tmp = path.with_suffix('.part')
            with urlopen(url, timeout=150) as src, tmp.open('wb') as dest:
                shutil.copyfileobj(src,dest)
                length = src.headers.get('Content-Length')
            if length and tmp.stat().st_size != int(length):
                raise IOError('incomplete download')
            tmp.replace(path)
            return
        except OSError:
            if i == 3: raise
            time.sleep(2**i)

def jobs():
    return [json.loads(p.read_text()) for p in sorted(OUT.glob('*/*/attempt*/job.json'))]

def run(provider, photo, attempt, reason, mask=None, prompt=None):
    slug = photo['dish']
    folder = OUT / slug / provider / f'attempt{attempt}'
    journal = folder / 'job.json'
    with (OUT/'.jobs.lock').open('a') as budget_lock:
        fcntl.flock(budget_lock,fcntl.LOCK_EX)
        records = jobs()
        if journal.exists():
            r = json.loads(journal.read_text())
            if r['status'] in ('succeeded','failed','aborted','canceled'): return
            if not r.get('job_id'): raise RuntimeError('Unresolved submission. Reconcile before starting new jobs.')
        else:
            if attempt == 2 and not (folder.parent/'attempt1/job.json').exists(): raise ValueError('Missing first attempt')
            if any(x['cost_usd'] is None and 'reserved_usd' not in x for x in records):
                raise RuntimeError('Reconcile earlier jobs first')
            remaining = LIMIT - sum(x['cost_usd'] if x['cost_usd'] is not None else x['reserved_usd'] for x in records)
            deadline = min(180, math.floor(remaining / RATE))
            if remaining <= 0 or (provider=='sam' and remaining<.50) or (provider=='idol' and remaining<.1) or (provider=='trellis' and deadline<5):
                raise RuntimeError('Budget exhausted')
            folder.mkdir(parents=True,exist_ok=True)
            r = dict(dish=slug,provider=provider,host='replicate' if provider=='trellis' else 'fal',attempt=attempt,
                     retry_reason=reason,job_id=None,status='submitting',runtime_s=None,cost_usd=None,paths={},stats=None,scores=None,publishable=None)
            r['reserved_usd']={'trellis':deadline*RATE,'idol':.1,'sam':.5}[provider]
            image = (ROOT/photo['filename']).read_bytes()
            assert hashlib.sha256(image).hexdigest()==photo['sha256']
            mime='image/jpeg'
            if mask and provider in ('trellis','idol'):
                from io import BytesIO
                from PIL import Image
                rgba=Image.open(BytesIO(image)).convert('RGBA')
                alpha=Image.open(mask).convert('L')
                if alpha.size!=rgba.size:raise ValueError('Mask must exactly match source dimensions')
                rgba.putalpha(alpha)
                dest=BytesIO();rgba.save(dest,format='PNG');image=dest.getvalue();mime='image/png'
                r['input_mask']=str(mask)
            uri = 'data:'+mime+';base64,' + base64.b64encode(image).decode()
            if provider=='trellis':
                endpoint, headers = REP, {'Authorization':'Bearer '+key('REPLICATE_API_TOKEN'),'Cancel-After':str(deadline)}
                payload = dict(version=VERSION,input=dict(images=[uri],save_gaussian_ply=True,generate_model=False,generate_color=False,generate_normal=False,return_no_background=True))
            else:
                endpoint, headers = 'https://queue.fal.run/'+FAL[provider], {'Authorization':'Key '+key('FAL_KEY')}
                payload = dict(image_url=uri,seed=42 if attempt==1 else 43)
                if provider=='idol':
                    payload['image_type']='real'
                else:
                    payload['prompt']=prompt or PROMPTS[slug]
                    r['prompt']=payload['prompt']
                    if mask:
                        payload['mask_urls']=['data:image/png;base64,'+base64.b64encode(Path(mask).read_bytes()).decode()]
                        r['input_mask']=str(Path(mask).relative_to(ROOT)) if Path(mask).is_absolute() else str(mask)
            save(journal,r)
            try:
                response = api(endpoint,headers,payload)
            except RuntimeError as e:
                if re.match(r'HTTP (400|401|402|403|413|422|429) ',str(e)):
                    stamp=utc_now()
                    rejection=dict(r,status='submission_rejected',cost_usd=0,http_status=int(str(e).split()[1]),
                                   timestamp_utc=stamp,rejection_body=str(e).split(': ',1)[-1],timestamp_basis='client observed HTTP response')
                    archive=OUT/'paid-rejections.json'
                    events=json.loads(archive.read_text()) if archive.exists() else []
                    save(archive,events+[rejection])
                    journal.unlink()  # explicit rejection, no prediction ID
                raise
            r['job_id'] = response.get('id') or response['request_id']
            r['submitted_utc']=utc_now()
            r['submission_billing_fields']={k:v for k,v in response.items() if any(w in k.lower() for w in ['bill','cost','price','usage'])}
            r['status'] = 'submitted'
            if provider in FAL:
                r['status_url'],r['response_url'] = response['status_url'],response['response_url']
            save(journal,r)
            print('submitted',slug,provider,r['job_id'],flush=True)
    if provider=='trellis':
        headers = {'Authorization':'Bearer '+key('REPLICATE_API_TOKEN')}
        while True:
            res = api(REP+'/'+r['job_id'],headers)
            if res['status'] not in ('starting','processing'): break
            time.sleep(3)
        metrics = res.get('metrics') or {}
        runtime = metrics.get('predict_time')
        r.update(runtime_s=runtime, cost_usd=None if runtime is None else runtime*RATE,
                 metrics=metrics,billing={k:v for k,v in res.items() if any(w in k for w in ['bill','price','cost'])}, version=res['version'])
        status = res['status']
        if status=='succeeded':
            raw = res['output']
            files = {'raw.ply':raw['gaussian_ply'],'mask.png':(raw.get('no_background_images') or [None])[0]}
        else:
            files={}
            r['provider_error']=str(res.get('error'))[:300]
    else:
        headers = {'Authorization':'Key '+key('FAL_KEY')}
        while True:
            progress=api(r['status_url'],headers)
            if progress['status']=='COMPLETED': break
            time.sleep(3)
        usage_headers={}
        try:
            res=api(r['response_url'],headers,response_headers=usage_headers)
        except RuntimeError as error:
            if 'HTTP 422' not in str(error): raise
            r.update(status='failed',provider_error=str(error),metrics=progress.get('metrics',{}),runtime_s=progress.get('metrics',{}).get('inference_time'),cost_usd=0,billing={'basis':'failed request, no successful output'})
            save(journal,r)
            print('failed',slug,provider,r['provider_error'],flush=True)
            return
        price=.10 if provider=='idol' else .02
        units=usage_headers.get('x-fal-billable-units')
        if units is None:
            units=max(1,len(res.get('individual_splats') or []),len(res.get('metadata') or [])) if provider=='sam' else 1
            basis='output count times published unit price; billing history unavailable'
        else:
            basis='response billable units times published unit price'
        bill=dict(basis=basis,units=float(units),unit_price=price,headers=usage_headers,response_fields={k:v for k,v in res.items() if any(w in k.lower() for w in ['bill','cost','price','usage'])})
        r.update(cost_usd=float(units)*price, billing=bill,queue_metrics=progress.get('metrics',{}))
        if provider=='idol':
            files={'raw.ply':res['model_mesh']['url'],'mask.png':res['preprocessed_image']['url']}
            r.update(runtime_s=res['timings']['inference'],metrics=res['timings'],camera=res['camera'],seed=res['seed'])
        else:
            files={'raw.ply':res['gaussian_splat']['url']}
            if res.get('artifacts_zip'): files['artifacts.zip']=res['artifacts_zip']['url']
            r.update(runtime_s=progress.get('metrics',{}).get('inference_time'),metadata=res.get('metadata'),individual_count=len(res.get('individual_splats') or []))
        status='succeeded'
    for name,url in files.items():
        if url:
            path = folder/name
            download(url,path)
            r['paths'][name.split('.')[0]]=str(path.relative_to(ROOT))
    r['status']=status
    save(journal,r)
    print(status,slug,provider,r['runtime_s'],r['cost_usd'],flush=True)

def main():
    parser=argparse.ArgumentParser(__doc__)
    parser.add_argument('provider',choices=['trellis','idol','sam'])
    parser.add_argument('--dish')
    parser.add_argument('--retry-reason')
    parser.add_argument('--mask')
    parser.add_argument('--prompt')
    args=parser.parse_args()
    if args.retry_reason and not args.dish: parser.error('Choose one broken dish for retry')
    if not key('FAL_KEY' if args.provider in FAL else 'REPLICATE_API_TOKEN'):
        parser.exit(2,'Missing provider key in repo .env\n')
    with (OUT/('.fal.lock' if args.provider in FAL else '.trellis.lock')).open('a') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        for photo in json.loads((ROOT/'sources/manifest.json').read_text()):
            if not args.dish or photo['dish']==args.dish:
                run(args.provider,photo,2 if args.retry_reason else 1,args.retry_reason,args.mask,args.prompt)

if __name__=='__main__': main()
