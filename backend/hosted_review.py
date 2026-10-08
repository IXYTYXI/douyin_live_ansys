"""Read-only selected recording behind an authenticated TLS reverse proxy."""
import os
from pathlib import Path
from datetime import datetime, timezone
from urllib.parse import urlsplit
from .pipeline import Pipeline
from .metrics import MetricsStore
from .server import make_server, MediaSigner


def main():
    pipeline = Pipeline.__new__(Pipeline)
    pipeline.root = Path(os.environ['DATA_DIR']).resolve()
    pipeline.schema = 'diting_asr_douyin_recording_test'
    pipeline.database_url = os.environ['REVIEW_DATABASE_URL']
    session = os.environ['REVIEW_SESSION']
    run = os.environ['REVIEW_METRICS_RUN']
    store = MetricsStore(pipeline.database_url)
    signer = MediaSigner(os.environ['MEDIA_SIGNING_KEY'], os.environ['PUBLIC_BASE_URL'])
    server = make_server(pipeline, signer, os.environ['REVIEW_API_KEY'], port=18776)
    base = server.RequestHandlerClass
    root = Path(__file__).parent.parent / 'review-demo/dist'
    files = {p.name for p in root.iterdir() if p.is_file()}

    class Hosted(base):
        def do_POST(self):
            self.close_connection = True
            self.reply(405, {'error': 'read-only deployment'})

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
                        'segments':data['segments'],'recordings':[{**r,'url':signer.url(r['media'],ttl=3600)} for r in data['recordings']]})
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
    server.serve_forever()

if __name__ == '__main__': main()
