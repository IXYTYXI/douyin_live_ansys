import copy
import os
from unittest.mock import Mock
import json
import tempfile
import threading
import unittest
import urllib.request
import urllib.error
from pathlib import Path
from backend.metrics import MetricsStore, Conflict
from backend.pipeline import Pipeline
from backend.server import make_server, MediaSigner


def batch():
    return {'schema': 1, 'batchId': 'batch-1', 'records': [
        {'id': 'record-1', 'runId': 'run-1', 'teacher': '测试主播',
         'capturedAt': '2026-09-24T04:00:00Z', 'metrics': {'online': {'value': 0}}}]}


class MetricsTest(unittest.TestCase):
    @unittest.skipUnless(os.getenv("METRICS_TEST_DATABASE_URL"), "requires dedicated PostgreSQL test database")
    def test_durable_dedup_and_atomic_conflict(self):
        with tempfile.TemporaryDirectory() as folder:
            path = os.environ['METRICS_TEST_DATABASE_URL']
            store = MetricsStore(path)
            store.migrate()
            with store.connect() as db:
                db.execute('TRUNCATE diting_metrics.samples, diting_metrics.batches RESTART IDENTITY')
            data = batch()
            self.assertEqual(store.accept(data)['acceptedIds'], ['record-1'])
            self.assertEqual(store.accept(data), store.accept(data))
            store = MetricsStore(path)
            self.assertEqual(len(store.read('run-1')['records']), 1)
            other = copy.deepcopy(data)
            other['batchId'] = 'batch-2'
            first = copy.deepcopy(other['records'][0])
            first['id'] = 'record-2'
            other['records'].insert(0, first)
            other['records'][1]['metrics']['online']['value'] = 99
            with self.assertRaises(Conflict):
                store.accept(other)
            self.assertEqual(len(store.read('run-1')['records']), 1)
            self.assertEqual(store.read('other')['records'], [])
            self.assertEqual(store.read('run-1', after=1)['records'], [])
            data['records'][0]['metrics']['online']['value'] = float('nan')
            with self.assertRaises(ValueError):
                store.accept(data)

    def test_http_ack_auth_conflict_and_query(self):
        with tempfile.TemporaryDirectory() as folder:
            store = Mock()
            store.accept.return_value = {'batchId': 'batch-1', 'acceptedIds': ['record-1']}
            store.read.return_value = {'records': batch()['records'], 'nextCursor': 1}
            server = make_server(None, None, 'k'*32, port=0, metrics=store)
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            base = 'http://127.0.0.1:' + str(server.server_port)
            def request(path, data=None, auth=True):
                headers = {'Content-Type': 'application/json'}
                if auth:
                    headers['Authorization'] = 'Bearer ' + 'k'*32
                req = urllib.request.Request(base + path, data=json.dumps(data).encode() if data is not None else None, headers=headers)
                with urllib.request.urlopen(req) as response:
                    return json.load(response)
            try:
                with self.assertRaises(urllib.error.HTTPError) as err:
                    request('/api/metrics/batches', batch(), False)
                self.assertEqual(err.exception.code, 401)
                ack = request('/api/metrics/batches', batch())
                self.assertEqual(ack, request('/api/metrics/batches', batch()))
                self.assertEqual(ack['acceptedIds'], ['record-1'])
                self.assertEqual(len(request('/api/metrics?runId=run-1')['records']), 1)
                store.accept.side_effect = Conflict('conflicting payload')
                changed = batch()
                changed['records'][0]['metrics']['online']['value'] = 9
                with self.assertRaises(urllib.error.HTTPError) as err:
                    request('/api/metrics/batches', changed)
                self.assertEqual(err.exception.code, 409)
                store.accept.side_effect = ValueError('invalid')
                with self.assertRaises(urllib.error.HTTPError) as err:
                    request('/api/metrics/batches', {'schema': 1})
                self.assertEqual(err.exception.code, 400)
            finally:
                server.shutdown()
                server.server_close()
                thread.join()

    def test_invalid_data_rejected_before_database(self):
        store = MetricsStore('postgresql://unused')
        store.connect = Mock(side_effect=AssertionError('must not access database'))
        for data in [{}, {'schema': 1, 'batchId': 'b', 'records': []}]:
            with self.assertRaises(ValueError):
                store.accept(data)
        data = batch()
        data['records'][0]['metrics']['online']['value'] = float('nan')
        with self.assertRaises(ValueError):
            store.accept(data)
        store.connect.assert_not_called()
