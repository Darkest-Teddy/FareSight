"""Use the paid Idol camera yaw in the native model coordinate convention."""
from concurrent.futures import ThreadPoolExecutor
from evaluate import ROOT,OUT,json,math,process

def one(photo):
    p=OUT/photo['dish']/'idol/attempt1/job.json'
    if not p.exists():return
    r=json.loads(p.read_text())
    if r.get('status')!='succeeded' or r['paths'].get('front_raw'):return
    azimuth=(-math.degrees(r['camera']['yaw']))%360
    process(p,photo,azimuth)
if __name__=='__main__':
    with ThreadPoolExecutor(2) as pool:list(pool.map(one,json.loads((ROOT/'sources/manifest.json').read_text())))
