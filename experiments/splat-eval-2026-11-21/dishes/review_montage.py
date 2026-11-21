"""Collect local compressed views and the uncompressed front for visual grading."""
import sys
from PIL import Image,ImageDraw
from evaluate import ROOT, OUT, VIEWS, draw_text
from run import jobs
def main(provider):
    rows=[r for r in jobs() if r['host'] in ['replicate','fal'] and r['provider']==provider and r['paths'].get('views')]
    if not rows:return
    size=152
    sheet=Image.new('RGB',(9*size,(size+24)*len(rows)),'white')
    d=ImageDraw.Draw(sheet)
    for i,r in enumerate(rows):
        y=i*(size+24)
        draw_text(d,(2,y),r['dish']+' '+str(r['attempt']),16)
        paths=[ROOT/'sources'/(r['dish']+'.jpg'),ROOT/r['paths']['front_raw'],*[ROOT/r['paths']['views'][k] for k in VIEWS],ROOT/r['paths']['front30k']]
        for k,path in enumerate(paths):
            im=Image.open(path);im.thumbnail((size,size));sheet.paste(im,(k*size,y+23))
    sheet.save(OUT/(provider+'-grading.jpg'))
if __name__=='__main__':main(sys.argv[1])
