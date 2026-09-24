"""Loopback-only preview of one explicitly selected ASR test session."""
import argparse
import secrets
from pathlib import Path
from urllib.parse import urlsplit
from datetime import datetime, timezone
from .pipeline import Pipeline
from .server import make_server, MediaSigner


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--session',required=True)
    parser.add_argument('--data',required=True)
    parser.add_argument('--business',default='douyin_asr_check')
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
                return self.reply(200,{'source':'asr-integration-test','id':args.session,
                    'startedAt':datetime.fromtimestamp(data['startedAtUnix'],timezone.utc).isoformat(),
                    'samples':[],'segments':data['segments'],
                    'duration':max((r['start']+r['duration'] for r in data['recordings']),default=45)})
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
