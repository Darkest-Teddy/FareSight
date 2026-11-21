"""Free Space fallback. Run with gradio_client 2.7.2. No paid submissions."""
import argparse, hashlib, json, time
from pathlib import Path
from urllib.request import urlopen
from gradio_client import Client, handle_file
from run import ROOT, OUT, download, save, key

HOSTS = {'idol':'speridlabs/idol','trellis':'trellis-community/TRELLIS'}
def remote_url(file):
    if isinstance(file,dict):
        return file.get('url') or remote_url(file.get('value'))
    if isinstance(file,str) and file.startswith('https://'): return file
    raise ValueError(f'Unexpected Gradio file field type: {type(file)}')

def run(model, dish, attempt=1, reason=None):
    repo = HOSTS[model]
    space = json.load(urlopen('https://huggingface.co/api/spaces/'+repo))
    folder = OUT / dish['dish'] / (model+'-space') / f'attempt{attempt}'
    folder.mkdir(parents=True, exist_ok=True)
    path = folder/'job.json'
    if path.exists():
        print('Already attempted',path,flush=True)
        return
    c=Client(space['host'], token=key('HF_TOKEN') or None, download_files=False, verbose=False, analytics_enabled=False)
    photo=ROOT/dish['filename']
    assert hashlib.sha256(photo.read_bytes()).hexdigest()==dish['sha256']
    r=dict(dish=dish['dish'], provider=model, host='huggingface-space', space=repo,space_commit=space['sha'],
           attempt=attempt,retry_reason=reason,job_id=None,session_id=c.session_hash,status='started',cost_usd=0,
           runtime_s=None,runtime_basis='client wall clock including queue and export',paths={},stats=None,scores=None,publishable=None,events={})
    start=time.monotonic()
    def stage(name,*args):
        r['stage']=name
        save(path,r)
        job=c.submit(*args,api_name='/'+name)
        try:
            return job.result(timeout=450)
        finally:
            eid=getattr(job.communicator,'event_id',None)
            if eid:
                r['events'][name]=eid
                if name in ('run','generate_and_extract_glb'):r['job_id']=eid
            save(path,r)
    try:
        file=handle_file(str(photo))
        seed=42 if attempt==1 else 43
        if model=='idol':
            result,_,_=stage('run',file,'Real photo',50,3.0,3.0,seed,False,'262,144')
        else:
            stage('start_session')
            masked=stage('preprocess_image',file)
            mask=folder/'mask.png'
            download(remote_url(masked),mask)
            r['paths']['mask']=str(mask.relative_to(ROOT))
            stage('generate_and_extract_glb',handle_file(str(mask)),[],seed,7.5,12,3.,12,'stochastic',.95,1024)
            _,result=stage('extract_gaussian')
        raw=folder/'raw.ply'
        download(remote_url(result),raw)
        r['paths']['raw']=str(raw.relative_to(ROOT))
        r.update(seed=seed,status='succeeded')
    except Exception as e:
        r.update(status='failed',error=str(e)[:900])
        raise
    finally:
        r['runtime_s']=round(time.monotonic()-start,3)
        save(path,r)
        print(dish['dish'],model,r['status'],r.get('error',''),flush=True)

if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('model',choices=list(HOSTS))
    parser.add_argument('--dish')
    parser.add_argument('--retry-reason')
    args=parser.parse_args()
    if args.retry_reason and not args.dish: parser.error('Choose one dish for a retry')
    for dish in json.loads((ROOT/'sources/manifest.json').read_text()):
        if not args.dish or args.dish==dish['dish']:
            run(args.model,dish,2 if args.retry_reason else 1,args.retry_reason)
