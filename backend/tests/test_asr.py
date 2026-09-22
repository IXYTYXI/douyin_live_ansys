import json
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from backend.asr import CompanyASR


class CompanyContractTest(unittest.TestCase):
    def test_submit_query_result_contract(self):
        observed = []
        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *_):
                pass

            def do_POST(self):
                body = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
                observed.append((self.path, self.headers['X-Api-Request-Id'], body))
                self.send_response(200)
                if self.path.endswith('/query'):
                    self.send_header('X-Api-Status-Code', '20000000')
                self.end_headers()
                if self.path.endswith('/submit'):
                    data = {'code': '20000000'}
                elif self.path.endswith('/result'):
                    # The upstream reference also accepts result responses without a code.
                    data = {'result': {'text': '实际接口契约测试'}}
                else:
                    data = {}
                self.wfile.write(json.dumps(data).encode())
        server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            provider = CompanyASR('http://127.0.0.1:' + str(server.server_port))
            provider.submit('stable-id', 'https://example.com/signed.wav')
            self.assertEqual(provider.poll('stable-id'), '实际接口契约测试')
            self.assertEqual([p[0] for p in observed], ['/asr/v1/qwen3/submit', '/asr/v1/qwen3/query', '/asr/v1/qwen3/result'])
            self.assertTrue(all(p[1] == 'stable-id' for p in observed))
            self.assertEqual(observed[0][2]['audio']['url'], 'https://example.com/signed.wav')
        finally:
            server.shutdown()
            server.server_close()
            thread.join()
