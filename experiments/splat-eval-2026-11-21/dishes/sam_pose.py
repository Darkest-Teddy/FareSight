"""Propose a table level from the SAM object-to-camera rotation, then inspect the profile."""
from orientations import *
from run import save
import math
def propose(r):
    m=r.get('metadata') or []
    if len(m)!=1 or not m[0].get('rotation'):return (0,0,0)
    w,x,y,z=np.array(m[0]['rotation']).reshape(-1)
    # Local +Z in camera PLY; the renderer changes PLY X/Y signs on input.
    nx,ny,nz=(-(2*x*z+2*w*y),-(2*y*z-2*w*x),1-2*x*x-2*y*y)
    return (round(math.degrees(math.atan2(-nz,ny)),2),0,round(math.degrees(math.atan2(nx,math.hypot(ny,nz))),2))
if __name__=='__main__':
    photos=json.loads((ROOT/'sources/manifest.json').read_text())
    for p in photos:
        for journal in (OUT/p['dish']/'sam').glob('attempt*/job.json'):
            r=json.loads(journal.read_text());folder=journal.parent
            if r['status']!='succeeded' or (folder/'level-review.json').exists():continue
            level=propose(r)
            preview('sam',p,r['attempt'],level)
            save(folder/'level-review.json',dict(proposed_level=level))
            print(p['dish'],level,flush=True)
