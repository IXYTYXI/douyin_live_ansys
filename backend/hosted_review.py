"""Read-only selected recording behind an authenticated TLS reverse proxy."""
import os
import json
import threading
from pathlib import Path
from datetime import datetime, timezone
from urllib.parse import urlsplit
from .pipeline import Pipeline
from .metrics import MetricsStore, Conflict
from .reviews import ReviewStore
from .summary_worker import run as summary_loop
from .server import make_server, MediaSigner


def main():
    pipeline = Pipeline.__new__(Pipeline)
    pipeline.root = Path(os.environ['DATA_DIR']).resolve()
    pipeline.schema = 'diting_asr_douyin_recording_test'
    pipeline.database_url = os.environ['REVIEW_DATABASE_URL']
    session = os.environ['REVIEW_SESSION']
    run = os.environ['REVIEW_METRICS_RUN']
    store = MetricsStore(pipeline.database_url)
    reviews = ReviewStore(pipeline.database_url)
    def review_data():
        data=pipeline.review(session)
        duration=max((r["start"]+r["duration"] for r in data["recordings"]),default=0)
        with store.connect() as db:
            rows=db.execute("SELECT extract(epoch FROM captured_at)-%s,payload::json FROM diting_metrics.samples WHERE run_id=%s ORDER BY captured_at",(data["startedAtUnix"],run)).fetchall()
        return {**data,"duration":duration,"samples":[{"t":float(t),"value":r["metrics"].get("online",{}).get("value")} for t,r in rows if 0<=float(t)<duration]}
    signer = MediaSigner(os.environ['MEDIA_SIGNING_KEY'], os.environ['PUBLIC_BASE_URL'])
    server = make_server(pipeline, signer, os.environ['REVIEW_API_KEY'], port=18776)
    base = server.RequestHandlerClass
    root = Path(__file__).parent.parent / 'review-demo/dist'
    files = {p.name for p in root.iterdir() if p.is_file()}

    class Hosted(base):
        def do_POST(self):
            self.close_connection = True
            if self.headers.get('X-Diting-Proxy') != os.environ['REVIEW_API_KEY']:
                return self.reply(401, {'error':'authentication required'})
            if self.headers.get('Origin') != os.environ['PUBLIC_BASE_URL']:
                return self.reply(403, {'error':'same-origin request required'})
            if urlsplit(self.path).path != '/api/reviews':return self.reply(404,{'error':'not found'})
            try:
                length=int(self.headers.get('Content-Length','0'))
                if not 0<length<=100000 or self.headers.get('Content-Type','').split(';')[0]!='application/json':raise ValueError()
                self.connection.settimeout(15)
                payload=json.loads(self.rfile.read(length))
                result=reviews.save_notes(session,payload['records'],review_data()['duration'])
                return self.reply(200,{'notes':result})
            except Conflict as e:return self.reply(409,{'error':str(e)})
            except (ValueError,KeyError,TypeError):return self.reply(400,{'error':'invalid review'})
            except Exception:return self.reply(503,{'error':'保存失败，请稍后重试'})

        def do_GET(self):
            path = urlsplit(self.path).path
            # All routes including media require reverse-proxy authentication.
            if self.headers.get('X-Diting-Proxy') != os.environ['REVIEW_API_KEY']:
                return self.reply(401, {'error': 'authentication required'})
            if path == '/api/test/session':
                try:
                    data = pipeline.review(session)
                    duration = max((r['start'] + r['duration'] for r in data['recordings']), default=0)
                    with store.connect() as db:
                        rows = db.execute('SELECT extract(epoch FROM captured_at)-%s,payload::json FROM diting_metrics.samples WHERE run_id=%s AND captured_at>=to_timestamp(%s) AND captured_at<to_timestamp(%s) ORDER BY captured_at', (data['startedAtUnix'], run, data['startedAtUnix'], data['startedAtUnix']+duration)).fetchall()
                    return self.reply(200, {'source':'asr-integration-test', 'id':session, 'realRecording':True,
                        'teacher':os.environ.get('REVIEW_TEACHER','录制测试主播'),
                        'startedAt':datetime.fromtimestamp(data['startedAtUnix'],timezone.utc).isoformat(),
                        'duration':duration,'samples':[{'t':float(t),'value':r['metrics'].get('online',{}).get('value')} for t,r in rows],
                        'databaseReviews':True,'notes':reviews.read_notes(session),'summaries':reviews.summaries(session),'summaryConfigured':bool(os.environ.get('SUMMARY_BASE_URL') and os.environ.get('SUMMARY_MODEL') and os.environ.get('SUMMARY_API_KEY')),'segments':data['segments'],'recordings':[{**r,'url':signer.url(r['media'],ttl=3600)} for r in data['recordings']]})
                except Exception:
                    return self.reply(503, {'error':'review temporarily unavailable'})
            if path.startswith('/media/'):
                return super().do_GET()
            if path == '/': path='/index.html'
            if path.lstrip('/') not in files:
                return self.reply(404, {'error':'not found'})
            target = root/path.lstrip('/')
            data = target.read_bytes()
            if target.suffix == '.html':
                data = data.replace(b'<head>',b'<head><meta name="diting-mode" content="real">')
            self.send_response(200)
            self.send_header('Content-Type',{'.mjs':'text/javascript','.css':'text/css','.html':'text/html'}.get(target.suffix,'application/octet-stream'))
            self.send_header('Content-Length',str(len(data)))
            self.send_header('Cache-Control','no-store')
            self.end_headers()
            self.wfile.write(data)
    server.RequestHandlerClass=Hosted
    threading.Thread(target=summary_loop,args=(reviews,session,review_data),daemon=True).start()
    server.serve_forever()

if __name__ == '__main__': main()
