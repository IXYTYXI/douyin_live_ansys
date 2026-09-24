"""Loopback-only end-to-end fixture: extension flush -> HTTP -> PostgreSQL -> review UI."""
import json
import math
import os
import secrets
import threading
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urlsplit
from .business import BusinessStore
from .server import make_server
import subprocess


def main():
    store = BusinessStore(os.environ['METRICS_TEST_DATABASE_URL'])
    store.migrate()
    key = secrets.token_urlsafe(32)
    run = str(uuid.uuid4())
    start = datetime.now(timezone.utc).replace(microsecond=0)-timedelta(minutes=30)
    with store.connect() as db:
        sid=db.execute('INSERT INTO diting.live_sessions(live_room_id,anchor_name,started_at,ended_at) VALUES(%s,%s,%s,%s) RETURNING id',
            ('synthetic-'+run,'联调测试主播',start,start+timedelta(minutes=30))).fetchone()[0]
    store.bind(run,sid)
    server=make_server(None,None,key,port=18773,metrics=store)
    original=server.RequestHandlerClass
    root=Path(__file__).parent.parent/'review-demo/dist'
    class DemoHandler(original):
        def do_GET(self):
            path=urlsplit(self.path).path
            if path=='/api/test/session':
                with store.connect() as db:
                    rows=db.execute('SELECT extract(epoch FROM sampled_at-%s::timestamptz),online_count FROM diting.online_samples WHERE session_id=%s ORDER BY sampled_at',(start,sid)).fetchall()
                return self.reply(200,{'source':'synthetic-integration-test','id':str(sid),'startedAt':start.isoformat(),'samples':[{'t':float(t),'value':v} for t,v in rows]})
            if path=='/': path='/index.html'
            if path.lstrip('/') in {p.name for p in root.iterdir() if p.is_file()}:
                target=root/path.lstrip('/')
                data=target.read_bytes()
                self.send_response(200)
                self.send_header('Content-Type', {'.mjs':'text/javascript','.css':'text/css','.html':'text/html'}.get(target.suffix,'application/octet-stream'))
                self.send_header('Content-Length',str(len(data)));self.end_headers();self.wfile.write(data);return
            return super().do_GET()
    server.RequestHandlerClass=DemoHandler
    thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
    rows=[]
    for i in range(180):
        metric=lambda v:{'value':v,'raw':str(v),'unit':'人','approximate':False}
        rows.append({'id':str(uuid.uuid4()),'runId':run,'teacher':'联调测试主播','platformSessionId':None,
            'capturedAt':(start+timedelta(seconds=i*10)).isoformat(),'gap':False,'foreground':True,
            'intervalMs':10000,'source':'synthetic-integration-test','metrics':{'online':metric(round(90+25*math.sin(i/15)+i/4))}})
    script="""
import {flush} from './anchor-collector/upload.mjs';
let input='';for await(const chunk of process.stdin)input+=chunk;
const state={records:JSON.parse(input)};
await flush({update:async fn=>fn(state),post:async batch=>{
 const r=await fetch('http://127.0.0.1:18773/api/metrics/batches',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+process.env.DEMO_UPLOAD_KEY},body:JSON.stringify(batch)});
 if(!r.ok)throw Error('HTTP '+r.status);return r.json();
}});
if(state.records.length)throw Error('Upload not acknowledged');
console.log('Extension flush acknowledged 180 simulated records');
"""
    try:
        subprocess.run(['node','--input-type=module','-e',script],input=json.dumps(rows),text=True,check=True,
            cwd=root.parent.parent,env={**os.environ,'DEMO_UPLOAD_KEY':key})
        print('Preview: http://127.0.0.1:18773/?test=1',flush=True)
        thread.join()
    except KeyboardInterrupt:
        pass
    finally:
        server.shutdown();server.server_close()


if __name__=='__main__': main()
