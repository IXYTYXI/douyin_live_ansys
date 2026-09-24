import argparse
import json
import os
import threading
from .asr import CompanyASR
from .pipeline import Pipeline
from .server import MediaSigner, make_server


def main():
    parser = argparse.ArgumentParser(description='Recording -> audio chunks -> ASR -> review API')
    parser.add_argument('--data', default=os.getenv('DATA_DIR', 'private-data/asr'))
    commands = parser.add_subparsers(dest='command', required=True)
    ingest = commands.add_parser('ingest', help='Import one COMPLETED local recording')
    ingest.add_argument('file')
    ingest.add_argument('--session', required=True)
    ingest.add_argument('--started-at', required=True, help='Actual live start ISO 8601 with timezone')
    ingest.add_argument('--recorded-at', required=True, help='First media frame ISO 8601 with timezone')
    ingest.add_argument('--chunk-seconds', type=int, default=45)
    review = commands.add_parser('review')
    review.add_argument('session')
    retry = commands.add_parser('retry')
    retry.add_argument('session')
    serve = commands.add_parser('serve')
    serve.add_argument('--host', default='127.0.0.1')
    serve.add_argument('--port', type=int, default=18772)
    serve.add_argument('--worker', action='store_true', help='Enable real ASR calls; off by default')
    args = parser.parse_args()
    pipeline = Pipeline(args.data, business=os.getenv('ASR_BUSINESS', 'douyin'),
                        max_inflight=int(os.getenv('ASR_MAX_INFLIGHT', '2')),
                        poll_seconds=float(os.getenv('ASR_POLL_SECONDS', '5')))
    if args.command == 'ingest':
        print(json.dumps({'recordingId': pipeline.ingest(args.session, args.started_at, args.recorded_at, args.file, args.chunk_seconds)}))
    elif args.command == 'review':
        print(json.dumps(pipeline.review(args.session), ensure_ascii=False, indent=2))
    elif args.command == 'retry':
        pipeline.retry(args.session)
    else:
        base = os.getenv('PUBLIC_BASE_URL', f'http://127.0.0.1:{args.port}')
        signer = MediaSigner(os.getenv('MEDIA_SIGNING_KEY', ''), base)
        provider = None
        if args.worker:
            if not os.getenv('PUBLIC_BASE_URL'):
                parser.error('PUBLIC_BASE_URL must be reachable by the ASR server')
            provider = CompanyASR(os.getenv('COMPANY_ASR_URL', ''), os.getenv('COMPANY_ASR_HOST', ''),
                                  os.getenv('COMPANY_ASR_UID', 'diting-douyin'), os.getenv('COMPANY_ASR_BEARER', ''),
                                  requests_per_minute=float(os.getenv('ASR_REQUESTS_PER_MINUTE', '60')))
        server = make_server(pipeline, signer, os.getenv('REVIEW_API_KEY', ''), args.host, args.port)
        stop = threading.Event()
        def work():
            while not stop.is_set():
                try:
                    worked = pipeline.step(provider, signer.url)
                except Exception as error:
                    print('Worker error:', type(error).__name__, flush=True)
                    worked = False
                stop.wait(0.2 if worked else 1)
        thread = threading.Thread(target=work, daemon=True) if provider else None
        if thread:
            thread.start()
        print(f'Review API listening on {args.host}:{server.server_port}; ASR worker={bool(provider)}', flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass
        finally:
            stop.set()
            server.server_close()
            if thread:
                thread.join(timeout=65)


if __name__ == '__main__':
    main()
