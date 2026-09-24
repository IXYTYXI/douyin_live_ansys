"""Local test HTTP service; put behind a TLS reverse proxy for external ASR access."""
import hashlib
import hmac
import json
import mimetypes
import re
import time
import psycopg
from .metrics import MetricsStore, Conflict
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlencode, urlsplit


class MediaSigner:
    def __init__(self, secret, base):
        if len(secret) < 24:
            raise ValueError('MEDIA_SIGNING_KEY must contain at least 24 characters')
        self.secret, self.base = secret.encode(), base.rstrip('/')

    def signature(self, name, expires):
        return hmac.new(self.secret, f'{name}:{expires}'.encode(), hashlib.sha256).hexdigest()

    def url(self, name, ttl=7 * 86400):
        expires = str(int(time.time()) + ttl)
        return self.base + '/media/' + name + '?' + urlencode({'expires': expires, 'sig': self.signature(name, expires)})

    def valid(self, name, query):
        try:
            expires, signature = query['expires'][0], query['sig'][0]
            return int(expires) >= time.time() and hmac.compare_digest(signature, self.signature(name, expires))
        except (KeyError, IndexError, ValueError):
            return False


def make_server(pipeline, signer, api_key, host='127.0.0.1', port=18772, metrics=None):
    if len(api_key) < 24:
        raise ValueError('REVIEW_API_KEY must contain at least 24 characters')


    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_):
            pass  # Do not log signed URLs or credentials.

        def reply(self, status, value):
            data = json.dumps(value, ensure_ascii=False).encode()
            self.send_response(status)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Cache-Control', 'no-store')
            self.send_header('Content-Length', str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def do_POST(self):
            if not hmac.compare_digest(self.headers.get('Authorization', ''), 'Bearer ' + api_key):
                self.close_connection = True
                return self.reply(401, {'error': 'unauthorized'})
            if urlsplit(self.path).path != '/api/metrics/batches':
                self.close_connection = True
                return self.reply(404, {'error': 'not found'})
            if metrics is None:
                return self.reply(503, {'error': 'metrics storage not configured'})
            try:
                length = int(self.headers.get('Content-Length', '0'))
                if self.headers.get('Transfer-Encoding') or not 0 < length <= 2_000_000:
                    self.close_connection = True
                    return self.reply(413, {'error': 'body must be 1 to 2000000 bytes'})
                if self.headers.get('Content-Type', '').split(';')[0] != 'application/json':
                    self.close_connection = True
                    return self.reply(415, {'error': 'application/json required'})
                self.connection.settimeout(15)
                batch = json.loads(self.rfile.read(length))
                ack = metrics.accept(batch)
                return self.reply(200, ack)
            except Conflict as error:
                return self.reply(409, {'error': str(error)})
            except (ValueError, UnicodeError):
                return self.reply(400, {'error': 'invalid batch'})
            except (psycopg.Error, OSError):
                return self.reply(503, {'error': 'storage unavailable; retry same batch'})

        def do_GET(self):
            parsed = urlsplit(self.path)
            query = parse_qs(parsed.query)
            path = parsed.path
            if path == '/health':
                return self.reply(200, {'ok': True})
            if path.startswith('/media/') and pipeline is not None:
                return self.media(path[len('/media/'):], query)
            if not hmac.compare_digest(self.headers.get('Authorization', ''), 'Bearer ' + api_key):
                return self.reply(401, {'error': 'unauthorized'})
            if path == '/api/metrics':
                if metrics is None:
                    return self.reply(503, {'error': 'metrics storage not configured'})
                try:
                    return self.reply(200, metrics.read(query.get('runId', [''])[0],
                        int(query.get('after', [0])[0]), int(query.get('limit', [300])[0])))
                except ValueError:
                    return self.reply(400, {'error': 'invalid query'})
                except psycopg.Error:
                    return self.reply(503, {'error': 'storage unavailable'})
            if pipeline is None:
                return self.reply(404, {'error': 'not found'})
            if not re.fullmatch(r'/api/sessions/[A-Za-z0-9_-]{1,100}', path):
                return self.reply(404, {'error': 'not found'})
            try:
                result = pipeline.review(path.rsplit('/', 1)[-1], float(query.get('start', [0])[0]), float(query.get('end', [1e12])[0]))
                for recording in result['recordings']:
                    recording['url'] = signer.url(recording.pop('media'))
                self.reply(200, result)
            except KeyError:
                self.reply(404, {'error': 'session not found'})
            except ValueError:
                self.reply(400, {'error': 'invalid time interval'})

        def media(self, name, query):
            if not signer.valid(name, query):
                return self.reply(401, {'error': 'expired or invalid signature'})
            if not re.fullmatch(r'[a-f0-9]{64}\.[a-z0-9]{1,8}', name):
                return self.reply(404, {'error': 'not found'})
            target = pipeline.root / 'media' / name
            if not target.is_file() or target.is_symlink():
                return self.reply(404, {'error': 'not found'})
            size = target.stat().st_size
            start, end, status = 0, size - 1, 200
            value = self.headers.get('Range')
            if value:
                match = re.fullmatch(r'bytes=(\d+)-(\d*)', value)
                if not match:
                    return self.reply(416, {'error': 'unsupported range'})
                start = int(match[1])
                end = min(int(match[2]) if match[2] else size - 1, size - 1)
                if start >= size or end < start:
                    return self.reply(416, {'error': 'invalid range'})
                status = 206
            self.send_response(status)
            self.send_header('Content-Type', mimetypes.guess_type(name)[0] or 'application/octet-stream')
            self.send_header('X-Content-Type-Options', 'nosniff')
            self.send_header('Cache-Control', 'private, no-store')
            self.send_header('Accept-Ranges', 'bytes')
            self.send_header('Content-Length', str(end - start + 1))
            if status == 206:
                self.send_header('Content-Range', f'bytes {start}-{end}/{size}')
            self.end_headers()
            try:
                with target.open('rb') as media:
                    media.seek(start)
                    remaining = end - start + 1
                    while remaining > 0:
                        chunk = media.read(min(65536, remaining))
                        if not chunk:
                            break
                        self.wfile.write(chunk)
                        remaining -= len(chunk)
            except (BrokenPipeError, ConnectionResetError):
                pass

    return ThreadingHTTPServer((host, port), Handler)
