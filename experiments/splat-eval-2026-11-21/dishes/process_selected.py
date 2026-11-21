"""Render an inspected paid attempt with its selected yaw and level correction."""
import sys
from evaluate import *
from level_sam import level
def selected(provider,slug,attempt,yaw,method='metadata'):
    photo=next(p for p in json.loads((ROOT/'sources/manifest.json').read_text()) if p['dish']==slug)
    path=OUT/slug/provider/f'attempt{attempt}'/'job.json'
    r=json.loads(path.read_text())
    if r['paths'].get('front_raw') and r.get('prep_method')==method:return
    if provider=='sam' or method in ('rim','flat'):rot=level(path.parent,r,method)
    else:rot=(0,0,0)
    if yaw=='camera':yaw=(-math.degrees(r['camera']['yaw']))%360
    process(path,photo,float(yaw),rot)
    r=json.loads(path.read_text());r['prep_method']=method;save(path,r)
if __name__=='__main__':selected(sys.argv[1],sys.argv[2],int(sys.argv[3]),sys.argv[4],sys.argv[5] if len(sys.argv)>5 else 'metadata')
