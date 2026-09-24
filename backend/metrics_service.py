"""Standalone PostgreSQL ingestion service; no ASR or SQLite initialization."""
import argparse
import os
from .business import BusinessStore
from .server import make_server


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('command', choices=['migrate', 'serve', 'bind'])
    parser.add_argument('--host', default='127.0.0.1')
    parser.add_argument('--port', type=int, default=18773)
    parser.add_argument('--run-id')
    parser.add_argument('--session-id', type=int)
    args = parser.parse_args()
    store = BusinessStore(os.environ.get('METRICS_DATABASE_URL'))
    if args.command == 'migrate':
        store.migrate()
        print('PostgreSQL metrics schema ready')
        return
    if args.command == 'bind':
        if not args.run_id or not args.session_id:
            parser.error('bind requires --run-id and --session-id')
        print({'projectedRecords': store.bind(args.run_id, args.session_id)})
        return
    server = make_server(None, None, os.environ.get('METRICS_API_KEY', ''), args.host, args.port, metrics=store)
    print(f'Metrics API listening on {args.host}:{server.server_port}', flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == '__main__':
    main()
