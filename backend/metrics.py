"""Durable collector inbox, isolated from ASR and business tables."""
import json
import math
import re
import psycopg
from datetime import datetime
from pathlib import Path


class Conflict(ValueError):
    pass


def identifier(value):
    return isinstance(value, str) and re.fullmatch(r'[A-Za-z0-9_-]{1,100}', value)


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'), allow_nan=False)


class MetricsStore:
    def __init__(self, dsn):
        if not dsn:
            raise ValueError('METRICS_DATABASE_URL is required')
        self.dsn = dsn

    def connect(self):
        return psycopg.connect(self.dsn, connect_timeout=10,
                               options='-c statement_timeout=15000 -c lock_timeout=10000')

    def migrate(self):
        with self.connect() as db:
            db.execute((Path(__file__).parent / 'migrations/001_metrics.sql').read_text())

    def accept(self, batch):
        if not isinstance(batch, dict) or batch.get('schema') != 1 or not identifier(batch.get('batchId')):
            raise ValueError('invalid batch')
        records = batch.get('records')
        if not isinstance(records, list) or not 1 <= len(records) <= 300:
            raise ValueError('expected 1 to 300 records')
        ids = set()
        for row in records:
            if not isinstance(row, dict) or not identifier(row.get('id')) or not identifier(row.get('runId')):
                raise ValueError('invalid record identifiers')
            if row['id'] in ids:
                raise ValueError('duplicate id within batch')
            ids.add(row['id'])
            if not isinstance(row.get('teacher'), str) or not 1 <= len(row['teacher']) <= 60:
                raise ValueError('invalid teacher')
            try:
                stamp = datetime.fromisoformat(row['capturedAt'].replace('Z', '+00:00'))
                if stamp.tzinfo is None:
                    raise ValueError()
            except (KeyError, TypeError, AttributeError, ValueError):
                raise ValueError('capturedAt requires timezone')
            metrics = row.get('metrics')
            if not isinstance(metrics, dict) or not metrics:
                raise ValueError('metrics required')
            for metric in metrics.values():
                if metric is None:
                    continue
                if not isinstance(metric, dict):
                    raise ValueError('invalid metric')
                value = metric.get('value')
                if type(value) not in (int, float) or not math.isfinite(value) or value < 0:
                    raise ValueError('invalid metric value')
        payload = canonical(batch)
        with self.connect() as db:
            db.execute('SELECT pg_advisory_xact_lock(7420192401)')
            old = db.execute('SELECT payload FROM diting_metrics.batches WHERE id=%s', (batch['batchId'],)).fetchone()
            if old and old[0] != payload:
                raise Conflict('batch id reused with different content')
            for row in records:
                encoded = canonical(row)
                old = db.execute('SELECT payload FROM diting_metrics.samples WHERE id=%s', (row['id'],)).fetchone()
                if old and old[0] != encoded:
                    raise Conflict('record id reused with different content')
                db.execute('INSERT INTO diting_metrics.samples(id,run_id,captured_at,payload) VALUES(%s,%s,%s,%s) ON CONFLICT(id) DO NOTHING',
                           (row['id'], row['runId'], row['capturedAt'], encoded))
            db.execute('INSERT INTO diting_metrics.batches VALUES(%s,%s) ON CONFLICT(id) DO NOTHING', (batch['batchId'], payload))
        return {'batchId': batch['batchId'], 'acceptedIds': [row['id'] for row in records]}

    def read(self, run_id, after=0, limit=300):
        if not identifier(run_id) or after < 0 or not 1 <= limit <= 1000:
            raise ValueError('invalid query')
        with self.connect() as db:
            rows = db.execute('SELECT seq,payload FROM diting_metrics.samples WHERE run_id=%s AND seq>%s ORDER BY seq LIMIT %s',
                              (run_id, after, limit)).fetchall()
        return {'records': [json.loads(row[1]) for row in rows], 'nextCursor': rows[-1][0] if rows else after}
