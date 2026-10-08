"""Upload-only inbox service. Database migrations are a deployment responsibility."""
import os
from .metrics import MetricsStore
from .server import make_server


def main():
    server = make_server(None, None, os.environ['METRICS_API_KEY'],
                         host='127.0.0.1', port=18777,
                         metrics=MetricsStore(os.environ['METRICS_DATABASE_URL']),
                         upload_only=True)
    try:
        server.serve_forever()
    finally:
        server.server_close()


if __name__ == '__main__':
    main()
