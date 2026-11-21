"""Tabulate the reviewed paid attempts for the Markdown report."""
import json
from decimal import Decimal, ROUND_HALF_UP
from sheets import TITLES, PROVIDERS, chosen_attempt
from run import ROOT

DISHES = list(TITLES)
PROVIDERS_IN_ORDER = list(PROVIDERS)
photos = json.loads((ROOT/'sources/manifest.json').read_text())
records = json.loads((ROOT/'results.json').read_text())
paid = [r for r in records if r.get('job_id') and r['host'] in ('fal','replicate')]
def attempts(dish, provider):
    return sorted((r for r in paid if r['dish']==dish and r['provider']==provider), key=lambda r:r['attempt'])
def money(value):
    rounded=Decimal(str(round(value,10))).quantize(Decimal('.01'),rounding=ROUND_HALF_UP)
    return f'${rounded:,.2f}'
def join_rows(headers,rows):
    return '\n'.join('| '+' | '.join(map(str,row))+' |' for row in [headers,['---']*len(headers),*rows])
def dollars(rows):
    return sum(r['cost_usd'] for r in rows)
def accepted(rows):
    return any(r.get('publishable') is True for r in rows)
def status(r):
    return 'yes' if r.get('publishable') else ('422' if r['status']=='failed' else 'no')
def policy(primary, backup=None, first_only=False):
    selected=[]
    success=0
    for dish in DISHES:
        a=attempts(dish,primary)
        if first_only:a=a[:1]
        group=list(a)
        if backup and not accepted(a):
            b=attempts(dish,backup)
            group.extend(b[:1] if first_only else b)
        selected.extend(group)
        success+=int(accepted(group))
    return dollars(selected),success
def tables():
    vals={}
    rows=[]
    for dish in DISHES:
        line=[f'[{TITLES[dish]}](outputs/contact-sheets/{dish}.png)']
        for provider in PROVIDERS_IN_ORDER:
            a=attempts(dish,provider)
            line.append(' → '.join(status(r) for r in a)+f' · ${dollars(a):.4f}')
        rows.append(line)
    vals['grid']=join_rows(['Dish and contact sheet',*PROVIDERS.values()],rows)
    rows=[]
    for provider,name in PROVIDERS.items():
        a=[r for r in paid if r['provider']==provider]
        c,n=policy(provider)
        first_c,first_n=policy(provider,first_only=True)
        rows.append([name,len(a),f'{first_n}/8',f'{n}/8 ({100*n/8:g}%)',f'${c:.4f}',f'${c/8:.4f}',f'${c/n:.4f}' if n else '—'])
    vals['summary']=join_rows(['Provider','Jobs','Accepted on first run','Accepted after retries','Cost of all attempts','Cost / menu item','Cost / accepted dish'],rows)
    scenarios=[(name,*policy(provider)) for provider,name in PROVIDERS.items()]
    scenarios.append(('SAM, then Idol on failures',*policy('sam','idol')))
    scenarios.append(('SAM, then Idol on failures · one attempt per provider',*policy('sam','idol',True)))
    rows=[]
    for name,c,n in scenarios:
        for count in [30,3]:
            rows.append([name,count,f'{count*n/8:g}',*[money(count*restaurants*c/8) for restaurants in [1,100,1000]],f'${c/n:.4f}' if n else '—'])
    vals['economics']=join_rows(['Policy','Items / restaurant','Expected accepted / restaurant','1 restaurant','100 restaurants','1,000 restaurants','Cost / accepted'],rows)
    rows=[]
    for dish in DISHES:
        for provider in PROVIDERS_IN_ORDER:
            for r in attempts(dish,provider):
                t=r.get('stats') or {};sc=r.get('scores') or {}
                assert r['status']=='failed' or len(sc)==5,(dish,provider,r['attempt'],sc)
                scores=' / '.join(str(sc[k]) for k in ('arrangement','vessel_completeness','height','rotation_cleanliness','compression_recognizability')) if sc else '—'
                evidence=r.get('score_evidence') or 'No masks returned for the explicit sushi-platter prompt. No splat to score.'
                rows.append([TITLES[dish],PROVIDERS[provider],r['attempt'],status(r),scores,evidence.replace('|','/').replace('\n',' ')])
    vals['grading']=join_rows(['Dish','Provider','#','Accepted','A / V / H / R / C','Evidence'],rows)
    rows=[]
    for dish in DISHES:
        for provider in PROVIDERS_IN_ORDER:
            for r in attempts(dish,provider):
                st=r.get('stats') or {}
                tiers=st.get('tiers') or {}
                yaw=st.get('camera_angles_deg',{}).get('front',['—'])[0]
                rotation=st.get('level_world_deg')
                rows.append([TITLES[dish],PROVIDERS[provider],r['attempt'],f"{r['runtime_s']:.2f}" if r.get('runtime_s') is not None else '—',f"${r['cost_usd']:.5f}",f"{st['count']:,}" if st else '—',f"{st['raw_bytes']/1e6:.2f}" if st else '—',*[f"{tiers[t]['bytes']/1e6:.3f}" if tiers else '—' for t in ['30k','60k']],', '.join(f'{a:g}' for a in rotation) if rotation and any(rotation) else ('native' if st else '—'),f'{yaw:.0f}' if isinstance(yaw,(float,int)) else '—'])
    vals['files']=join_rows(['Dish','Provider','#','Runtime s','Cost USD','Raw Gaussians','PLY MB','30k MB','60k MB','Level XYZ °','Photo yaw °'],rows)
    vals['photos']=join_rows(['Subject','Nominal width','Elevation','Credit','License'],[[f"[{TITLES[p['dish']]}]({p['page']})",f"{p['target_width_m']*100:g} cm",f"{next(r for r in paid if r['dish']==p['dish'] and r.get('stats'))['stats']['camera_angles_deg']['front'][1]}°",p['author'],f"[{p['license']}]({p['license_url']})"] for p in photos])
    return vals
if __name__=='__main__':
    for name,table in tables().items():
        print('\n'+name+'\n\n'+table)
