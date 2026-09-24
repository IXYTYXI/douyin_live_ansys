"""Loopback-only preview of one explicitly selected ASR test session."""
import argparse
import secrets
from pathlib import Path
from urllib.parse import urlsplit
from datetime import datetime, timezone
from .pipeline import Pipeline
from .metrics import MetricsStore
import os
from .server import make_server, MediaSigner


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--session',required=True)
    parser.add_argument('--data',required=True)
    parser.add_argument('--business',default='douyin_asr_check')
    parser.add_argument('--metrics-session',type=int,help='Explicit synthetic metrics session to combine for local testing')
    args=parser.parse_args()
    pipeline=Pipeline(args.data,business=args.business)
    signer=MediaSigner(secrets.token_urlsafe(32),'http://127.0.0.1:18774')
    server=make_server(pipeline,signer,secrets.token_urlsafe(32),port=18774)
    base=server.RequestHandlerClass
    root=Path(__file__).parent.parent/'review-demo/dist'
    class Preview(base):
        def do_GET(self):
            path=urlsplit(self.path).path
            if path=='/api/test/session':
                data=pipeline.review(args.session)
                samples=[]
                if args.metrics_session:
                    store=MetricsStore(os.environ['METRICS_TEST_DATABASE_URL'])
                    with store.connect() as db:
                        row=db.execute('SELECT live_room_id FROM diting.live_sessions WHERE id=%s',(args.metrics_session,)).fetchone()
                        if not row or not row[0].startswith('synthetic-'):
                            return self.reply(400,{'error':'Only synthetic metrics may be combined'})
                        rows=db.execute('SELECT extract(epoch FROM o.sampled_at-s.started_at),o.online_count FROM diting.online_samples o JOIN diting.live_sessions s ON s.id=o.session_id WHERE s.id=%s ORDER BY o.sampled_at',(args.metrics_session,)).fetchall()
                        samples=[{'t':float(t),'value':v} for t,v in rows]
                recordings=[{**r,'url':signer.url(r['media'])} for r in data['recordings']]
                return self.reply(200,{'source':'asr-integration-test','id':args.session,
                    'startedAt':datetime.fromtimestamp(data['startedAtUnix'],timezone.utc).isoformat(),
                    'samples':samples,'segments':data['segments'],'combinedTest':bool(args.metrics_session),'recordings':recordings,
                    'duration':max(1800 if args.metrics_session else 0,max((r['start']+r['duration'] for r in data['recordings']),default=45))})
            if path=='/':path='/index.html'
            if path.lstrip('/') in {p.name for p in root.iterdir() if p.is_file()}:
                target=root/path.lstrip('/');data=target.read_bytes()
                self.send_response(200);self.send_header('Content-Type',{'.mjs':'text/javascript','.css':'text/css','.html':'text/html'}.get(target.suffix,'application/octet-stream'))
                self.send_header('Content-Length',str(len(data)));self.end_headers();self.wfile.write(data);return
            super().do_GET()
    server.RequestHandlerClass=Preview
    print('ASR preview: http://127.0.0.1:18774/?test=1',flush=True)
    try:server.serve_forever()
    except KeyboardInterrupt:pass
    finally:server.server_close()


if __name__=='__main__':main()
