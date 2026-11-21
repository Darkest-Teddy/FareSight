"""Normalize raw PLY, build two SOG tiers, and render review views from the 60k SOG."""
import argparse, json, math, re, subprocess, zipfile
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageOps
from run import ROOT, OUT, save

CLI = ['npx','-y','@playcanvas/splat-transform@3.12.0','--quiet','--overwrite']
def cli(*args):
    subprocess.run([*CLI,*map(str,args)],check=True,timeout=240)

def vertices(path):
    with path.open('rb') as f:
        header=b''
        while not header.endswith(b'end_header\n') and len(header)<65536:
            part=f.readline()
            if not part:break
            header+=part
        txt=header.decode('ascii')
        assert 'format binary_little_endian' in txt and txt.endswith('end_header\n')
        n=int(re.search(r'element vertex (\d+)',txt)[1])
        fields=re.findall(r'^property (\w+) (\w+)$',txt,re.M)
        dtype=np.dtype([(name,{'float':'<f4','float32':'<f4'}[t]) for t,name in fields])
        a=np.fromfile(f,dtype,count=n)
        assert len(a)==n and not f.read(1)
        return header,a

ELEVATIONS={'ramen': 65, 'curry':58,'tiramisu':30,'burger':15,'cocktail':14,'pizza':45,'sushi':26,'salad':37}
VIEWS=['front','side','top','back','minus30','plus30']

def normalize(folder,target,level=(0,0,0),legacy=False):
    path=folder/'raw.ply'
    header,a=vertices(path)
    raw_xyz=np.column_stack([a[k] for k in 'xyz']).astype('float64')
    if any(level):
        leveled=folder/'leveled.ply'
        cli(path,'--rotate',','.join(map(str,level)),leveled)
        header,a=vertices(leveled)
    xyz=np.column_stack([a[k] for k in 'xyz']).astype('float64')
    assert np.isfinite(xyz).all()
    low,high=np.quantile(xyz,[.05,.95],axis=0)
    robust_width=max((high-low)[[0,2]])
    visible=a['opacity'] > -2.1972 if 'opacity' in a.dtype.names else a['opacity_linear']>.10
    bounds_low,bounds_high=np.quantile(xyz[visible],[.001,.999],axis=0)
    width=robust_width if legacy else max((bounds_high-bounds_low)[[0,2]])
    factor=target/width
    center=(low+high)/2 if legacy else (bounds_low+bounds_high)/2
    center[1]=np.quantile(xyz[:,1],.995) if legacy else bounds_high[1]
    norm=(xyz-center)*factor
    for i,k in enumerate('xyz'):a[k]=norm[:,i]
    for i in range(3):a[f'scale_{i}']+=math.log(factor)
    with (folder/'normalized.ply').open('wb') as f:
        f.write(header)
        a.tofile(f)
    bounds=lambda a:dict(min=a.min(axis=0).tolist(),max=a.max(axis=0).tolist())
    return dict(count=len(a),raw_bytes=path.stat().st_size,raw_bounds=bounds(raw_xyz),raw_p05=low.tolist(),raw_p95=high.tolist(),
                raw_robust_width=float(robust_width),calibration_width=float(width),level_world_deg=list(level),manual_reorientation=any(level),calibration='p05-p95' if legacy else 'p0.1-p99.9 of opacity > 0.10',target_width_m=target,scale_factor=float(factor),raw_origin=center.tolist(),
                normalized_bounds_m=bounds(norm),normalized_robust_width_m=float(robust_width*factor),
                camera_target_y_m=float(-np.mean(np.quantile(norm[:,1],[.01,.99]))),
                frame_size_m=float(np.max(np.ptp(np.quantile(norm,[.001,.999],axis=0),axis=0))))

def render(folder, stats, frames, prefix, resolution, tier='60k.sog'):
    target=[0,stats['camera_target_y_m'],0]
    distance=stats['frame_size_m']*2.55
    cameras=[]
    for az,el in frames:
        a,e=map(math.radians,[az,el])
        v=np.array([math.sin(a)*math.cos(e), math.sin(e),math.cos(a)*math.cos(e)])
        up=[-math.sin(a),0,-math.cos(a)] if el==90 else [0,1,0]
        cameras.append(dict(position=(np.array(target)+v*distance).tolist(),target=target,fov=32,up=up))
    track=folder/(prefix+'-cameras.json')
    save(track,dict(frameRate=1,frames=cameras))
    rotation=[] if tier=='normalized.ply' else ['--rotate','0,0,180']
    cli(folder/tier,*rotation,'--camera-track',track,'--camera-near','.002','--resolution',resolution,'--background','.18,.20,.22,1',folder/(prefix+'.webp'))
    return sorted(folder.glob(prefix+'.*.webp'))

def draw_text(draw, xy, text, size=20):
    try:font=ImageFont.truetype('/System/Library/Fonts/Helvetica.ttc',size)
    except OSError:font=ImageFont.load_default(size=size)
    draw.text(xy,text,font=font,fill='#21313b')

def process(journal,photo,azimuth,level=None):
    r=json.loads(journal.read_text())
    if r['status']!='succeeded':return
    folder=journal.parent
    previous=r.get('stats') or {}
    level=tuple(level) if level is not None else tuple(previous.get('level_world_deg',[0,0,0]))
    legacy=r['host']=='huggingface-space'
    stats=normalize(folder,photo['target_width_m'],level,legacy)
    regenerate=bool(previous) and previous.get('level_world_deg',[0,0,0])!=list(level)
    tiers={}
    for n in (30000,60000):
        name=f'{n//1000}k'
        sog=folder/(name+'.sog')
        if regenerate or not sog.exists():
            src=folder/'normalized.ply'
            if stats['count']>n:
                slim=folder/(name+'.ply')
                cli('--gpu','cpu',src,'--decimate',n,slim)
                src=slim
            cli('--gpu','cpu',src,'--rotate','0,0,180',sog)
        with zipfile.ZipFile(sog) as z:
            assert z.testzip() is None
            meta=json.loads(z.read('meta.json'))
        assert meta['count']==min(stats['count'],n)
        tiers[name]=dict(count=meta['count'],bytes=sog.stat().st_size,version=meta['version'])
        decoded=folder/(name+'-decoded.ply')
        cli(sog,decoded)
        try:
            _,data=vertices(decoded)
            assert len(data)==meta['count']
            tiers[name]['decoded_y_range_m']=[float(data['y'].min()),float(data['y'].max())]
            horizontal=np.column_stack([data['x'],data['z']])
            low,high=np.quantile(horizontal,[.05,.95],axis=0)
            tiers[name]['decoded_robust_width_m']=float(max(high-low))
            tiers[name]['decoded_full_width_m']=float(max(np.ptp(horizontal,axis=0)))
        finally:
            decoded.unlink(missing_ok=True)
        r['paths'][name]=str(sog.relative_to(ROOT))
    stats['tiers']=tiers
    r['paths']['normalized']=str((folder/'normalized.ply').relative_to(ROOT))
    if azimuth is None:
        frames=[(angle,35) for angle in range(0,360,45)]
        images=render(folder,stats,frames,'orbit','256x256')
        result=Image.new('RGB',(4*256,2*285),'white')
        draw=ImageDraw.Draw(result)
        for i,(path,(a,e)) in enumerate(zip(images,frames)):
            xy=(i%4*256,i//4*285)
            result.paste(Image.open(path),xy)
            draw_text(draw,(xy[0]+5,xy[1]+257),str(a))
        result.save(folder/'orbit.jpg')
    else:
        pitch=ELEVATIONS[photo['dish']]
        frames=[(azimuth,pitch),(azimuth+90,5),(azimuth,90),(azimuth+180,20),(azimuth-30,pitch),(azimuth+30,pitch)]
        images=render(folder,stats,frames,'view','512x512')
        assert len(images)==6
        low=render(folder,stats,frames[:1],'low','512x512','30k.sog')[0]
        r['paths']['front30k']=str(low.relative_to(ROOT))
        raw=render(folder,stats,frames[:1],'full','512x512','normalized.ply')[0]
        r['paths']['front_raw']=str(raw.relative_to(ROOT))
        r['paths']['views']={k:str(p.relative_to(ROOT)) for k,p in zip(VIEWS,images)}
        stats['camera_angles_deg']=dict(zip(VIEWS,frames))
    r['stats']=stats
    save(journal,r)
    print(r['dish'],r['provider'],tiers,flush=True)

if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--dish')
    parser.add_argument('--azimuth',type=int,default=None)
    parser.add_argument('--provider')
    parser.add_argument('--level',help='World-space XYZ Euler correction in degrees, for example --level=0,0,-7')
    args=parser.parse_args()
    level=[float(a) for a in args.level.split(',')] if args.level else None
    for photo in json.loads((ROOT/'sources/manifest.json').read_text()):
        if args.dish and photo['dish']!=args.dish:continue
        for job in (OUT/photo['dish']).glob('*/attempt*/job.json'):
            if not args.provider or args.provider==job.parent.parent.name:
                process(job,photo,args.azimuth,level)
