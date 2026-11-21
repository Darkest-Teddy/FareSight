"""Review the object's six directions and candidate source azimuths before leveling and export."""
import json,sys
import numpy as np
from PIL import Image,ImageDraw
from evaluate import ROOT,OUT,normalize,render,draw_text,ELEVATIONS

def preview(provider,photo,attempt=1,level=(0,0,0)):
    folder=OUT/photo['dish']/provider/f'attempt{attempt}'
    stats=normalize(folder,photo['target_width_m'],level)
    angles=[(a,ELEVATIONS[photo['dish']]) for a in range(0,360,45)]+[(0,0),(90,0),(0,90),(0,-89.9)]
    paths=render(folder,stats,angles,'preview','224x224','normalized.ply')
    sheet=Image.new('RGB',(224*4,250*3),'white')
    d=ImageDraw.Draw(sheet)
    for i,(p,angle) in enumerate(zip(paths,angles)):
        x=i%4*224;y=i//4*250
        sheet.paste(Image.open(p),(x,y))
        draw_text(d,(x+2,y+225),str(angle),16)
    sheet.save(folder/'orientation.jpg')

if __name__=='__main__':
    photos=json.loads((ROOT/'sources/manifest.json').read_text())
    for photo in photos:
        if len(sys.argv)>2 and photo['dish']!=sys.argv[2]:continue
        folder=OUT/photo['dish']/sys.argv[1]/'attempt1'
        if not (folder/'raw.ply').exists() or (folder/'orientation.jpg').exists():continue
        preview(sys.argv[1],photo)
