"""Read existing fal queue records to preserve the billing evidence visible with this key."""
import json
from urllib.error import HTTPError
from urllib.request import Request, urlopen
from run import FAL, OUT, jobs, key, save, utc_now

def billing_fields(obj):
    return {k:v for k,v in obj.items() if any(term in k.lower() for term in ('bill','price','cost','usage'))}

def main():
    path=OUT/'fal-response-billing.json'
    observed=json.loads(path.read_text()) if path.exists() else {}
    for job in jobs():
        if job['host']!='fal' or job['provider'] not in FAL or job['status'] not in ('failed','succeeded') or job['job_id'] in observed:
            continue
        snapshots={}
        for stage in ('status','response'):
            req=Request(job[stage+'_url'],headers={'Authorization':'Key '+key('FAL_KEY'),'User-Agent':'FareSight-Splat-Eval/1.0'})
            try:
                response=urlopen(req,timeout=30)
            except HTTPError as exc:
                response=exc
            with response:
                payload=json.load(response)
                snapshots[stage]=dict(http_status=response.status,headers=billing_fields(response.headers),fields=billing_fields(payload),timestamp_utc=utc_now())
            if response.status==403:
                snapshots[stage]['rejection_body']=payload
        observed[job['job_id']]=snapshots
        save(path,observed)
    print(f'Collected billing fields for {len(observed)} fal jobs.')
if __name__=='__main__':main()
