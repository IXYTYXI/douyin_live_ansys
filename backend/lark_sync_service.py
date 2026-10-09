"""Independent timer job; no changes to ingestion, stream or review services."""
import argparse
import fcntl
import json
import os
import sys
import time
import urllib.request
from datetime import datetime
from pathlib import Path
from .lark_sync import LarkCLI, project, sync_rows, date_text


def atomic_json(path, value):
    path = Path(path); path.parent.mkdir(parents=True,exist_ok=True)
    temporary = path.with_suffix('.tmp')
    fd = os.open(temporary,os.O_WRONLY|os.O_CREAT|os.O_TRUNC,0o600)
    with os.fdopen(fd,'w') as output:
        json.dump(value,output,ensure_ascii=False);output.flush();os.fsync(output.fileno())
    os.replace(temporary,path)


def read_env(path):
    # Deployment-generated KEY=value files; never execute shell contents.
    result = {}
    for line in Path(path).read_text().splitlines():
        if '=' in line and not line.lstrip().startswith('#'):
            k,v=line.split('=',1);result[k]=v.strip().strip('"').strip("'")
    return result


def collect(config, env):
    import psycopg
    def get(path):
        req=urllib.request.Request('http://127.0.0.1:18776'+path,headers={'X-Diting-Proxy':env['REVIEW_API_KEY']})
        with urllib.request.urlopen(req,timeout=30) as response:return json.load(response)
    result=[]
    for meta in get('/api/sessions')['sessions']:
        if meta['teacher'] not in config['teachers'] or datetime.fromisoformat(meta['startedAt'].replace('Z','+00:00')).timestamp() < datetime.fromisoformat(config['since'].replace('Z','+00:00')).timestamp():continue
        data=get('/api/sessions/'+meta['id'])
        # These fields are not exported to Feishu and must not enter snapshot files.
        for r in data.get('recordings',[]):r.pop('url',None);r.pop('media',None)
        start=data['startedAtUnix'];end=start+data['duration']
        with psycopg.connect(env['REVIEW_DATABASE_URL'],options='-c default_transaction_read_only=on') as db:
            rows=db.execute("""SELECT id,captured_at,received_at,payload FROM diting_metrics.samples
                WHERE payload::jsonb->>'teacher'=%s AND captured_at>=to_timestamp(%s)
                  AND captured_at<to_timestamp(%s) ORDER BY captured_at,id""",(meta['teacher'],start,end)).fetchall()
        data['rawSamples']=[]
        for rid,captured,received,payload in rows:
            payload=json.loads(payload) if isinstance(payload,str) else payload
            if not data.get('channelId') and payload.get('runId')!=data.get('runId'):continue
            value=payload.get('metrics',{}).get('online',{}).get('value')
            data['rawSamples'].append({'id':rid,'captured':captured.timestamp(),'received':received.timestamp(),'value':value})
        result.append(data)
    return result


def synchronize(config, snapshots, state, client):
    report=[];now=date_text(time.time())
    for data in snapshots:
        session,periods=project(data,config['public_url'])
        client.validate_fields(config['tables']['sessions'],list(session)+['最近同步时间'])
        ids=sync_rows(client,config['tables']['sessions'],[session],state,now)
        parent=[{'id':ids[session['同步键']]}]
        for row in periods:row['所属场次']=parent
        if periods:
            client.validate_fields(config['tables']['periods'],list(periods[0])+['最近同步时间'])
            sync_rows(client,config['tables']['periods'],periods,state,now)
        samples=[{'采样':data['teacher']+' · '+date_text(s['captured']),
                  '同步键':data['id']+':'+s['id'],'主播':data['teacher'],
                  '采样时间':date_text(s['captured']),'接收时间':date_text(s['received']),
                  '在线人数':s['value'],'所属场次':parent} for s in data.get('rawSamples',[])]
        if samples:
            client.validate_fields(config['tables']['samples'],list(samples[0])+['最近同步时间'])
            sync_rows(client,config['tables']['samples'],samples,state,now)
        report.append({'session':data['id'],'periods':len(periods),'samples':len(samples)})
    return report


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--config',required=True)
    parser.add_argument('--env-file',default='/etc/diting-review.env')
    parser.add_argument('--snapshot',help='Locally exported real data for initial verification')
    args=parser.parse_args();config=json.loads(Path(args.config).read_text())
    if not config.get('teachers') or not config.get('since'):raise ValueError('explicit scope required')
    state_path=Path(config['state_file']);state_path.parent.mkdir(parents=True,exist_ok=True)
    with open(state_path.with_suffix('.lock'),'a') as lock:
        try:fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        except BlockingIOError:return
        state=json.loads(state_path.read_text()) if state_path.exists() else {}
        try:
            snapshots=json.loads(Path(args.snapshot).read_text()) if args.snapshot else collect(config,read_env(args.env_file))
            # Apply scope also to imported snapshots, not only HTTP source discovery.
            snapshots=[d for d in snapshots if d['teacher'] in config['teachers'] and
                       d['startedAtUnix']>=datetime.fromisoformat(config['since'].replace('Z','+00:00')).timestamp()]
            report=synchronize(config,snapshots,state,LarkCLI(config['base_token'],config.get('lark_cli','lark-cli')))
            atomic_json(state_path,state)
            atomic_json(state_path.with_name('status.json'),{'ok':True,'checkedAt':time.time(),'sessions':report})
            print(json.dumps({'ok':True,'sessions':report},ensure_ascii=False))
        except Exception as exc:
            # Remote keys are reconciled again on next invocation; no false success checkpoint.
            atomic_json(state_path.with_name('status.json'),{'ok':False,'checkedAt':time.time(),'errorType':type(exc).__name__})
            print('Feishu sync failed: '+type(exc).__name__,file=sys.stderr);raise SystemExit(1)

if __name__=='__main__':main()
