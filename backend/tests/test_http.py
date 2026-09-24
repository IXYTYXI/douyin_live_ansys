import os
import uuid
import json
import tempfile
import threading
import unittest
import urllib.request
from pathlib import Path
from backend.pipeline import Pipeline
from backend.server import make_server, MediaSigner


@unittest.skipUnless(os.getenv("ASR_DATABASE_URL"), "requires PostgreSQL test database")
class HTTPTest(unittest.TestCase):
    def test_signed_media_and_review_auth(self):
        with tempfile.TemporaryDirectory() as folder:
            pipeline = Pipeline(folder, business='test_' + uuid.uuid4().hex)
            key = 'a' * 64 + '.wav'
            (Path(folder) / 'media' / key).write_bytes(b'0123456789')
            signer = MediaSigner('s' * 32, 'http://127.0.0.1')
            server = make_server(pipeline, signer, 'k' * 32, '127.0.0.1', 0)
            base = 'http://127.0.0.1:' + str(server.server_port)
            signer.base = base
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            try:
                request = urllib.request.Request(signer.url(key), headers={'Range': 'bytes=2-5'})
                with urllib.request.urlopen(request) as response:
                    self.assertEqual(response.status, 206)
                    self.assertEqual(response.read(), b'2345')
                for url in [base + '/api/sessions/test', base + '/media/' + key, signer.url(key, ttl=-1)]:
                    with self.assertRaises(urllib.error.HTTPError) as err:
                        urllib.request.urlopen(url)
                    self.assertEqual(err.exception.code, 401)
                request = urllib.request.Request(base + '/api/sessions/test', headers={'Authorization': 'Bearer ' + 'k' * 32})
                with self.assertRaises(urllib.error.HTTPError) as err:
                    urllib.request.urlopen(request)
                self.assertEqual(err.exception.code, 404)
            finally:
                server.shutdown()
                server.server_close()
                thread.join()
