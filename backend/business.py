"""Explicit collector-run to business-session projection; never infer sessions by name."""
import json
from pathlib import Path
from .metrics import MetricsStore, Conflict


FIELDS = {'online': 'online_count', 'previewOnline': 'preview_online',
          'giftUsers': 'gift_users', 'commentUsers': 'comment_users',
          'likes': 'likes', 'shares': 'shares', 'fanClubJoins': 'fan_club_joins',
          'newFollowers': 'new_fans'}


def project(db, row):
    binding = db.execute('SELECT session_id FROM diting.capture_run_bindings WHERE run_id=%s', (row['runId'],)).fetchone()
    if not binding:
        return False
    session_id = binding[0]
    valid = db.execute('SELECT 1 FROM diting.live_sessions WHERE id=%s AND started_at<=%s::timestamptz AND (ended_at IS NULL OR ended_at>=%s::timestamptz)',
                       (session_id, row['capturedAt'], row['capturedAt'])).fetchone()
    if not valid:
        raise Conflict('capture outside bound session')
    values = []
    for key in FIELDS:
        metric = row['metrics'].get(key)
        value = metric.get('value') if metric else None
        if value is not None and (value != int(value) or value > 9223372036854775807):
            raise ValueError('count requires nonnegative bigint')
        values.append(value)
    stay = row['metrics'].get('averageStay') or {}
    raw = json.dumps(row, ensure_ascii=False, allow_nan=False)
    status = json.dumps({'gap': row.get('gap', False), 'foreground': row.get('foreground'),
                         'averageStayUnit': stay.get('unit')})
    # Column names come exclusively from the fixed map above.
    db.execute('INSERT INTO diting.capture_snapshots(session_id,request_id,captured_at,' + ','.join(FIELDS.values()) + ',average_stay_raw,raw_payload,source_status) VALUES (' + ','.join(['%s']*14) + ') ON CONFLICT(request_id) DO NOTHING',
               (session_id, row['id'], row['capturedAt'], *values, stay.get('raw'), raw, status))
    online = values[0]
    if online is not None and online > 2147483647:
        raise ValueError('online count exceeds integer range')
    db.execute('INSERT INTO diting.online_samples(session_id,sampled_at,online_count,is_stale,raw_payload) VALUES(%s,%s,%s,%s,%s) ON CONFLICT(session_id,sampled_at) DO NOTHING',
               (session_id, row['capturedAt'], online, bool(row.get('gap')), raw))
    return True


class BusinessStore(MetricsStore):
    def migrate(self):
        super().migrate()
        with self.connect() as db:
            # Original reviewed schema is versioned intact; strip its wrapper for one transaction.
            schema = (Path(__file__).parent.parent / 'db/schema.sql').read_text()
            db.execute(schema.replace('BEGIN;', '').replace('COMMIT;', ''))
            db.execute((Path(__file__).parent / 'migrations/003_business_metrics.sql').read_text())

    def bind(self, run_id, session_id):
        with self.connect() as db:
            db.execute('SELECT pg_advisory_xact_lock(7420192401)')
            current = db.execute('SELECT session_id FROM diting.capture_run_bindings WHERE run_id=%s', (run_id,)).fetchone()
            if current and current[0] != session_id:
                raise Conflict('run already bound to another session')
            db.execute('INSERT INTO diting.capture_run_bindings(run_id,session_id) VALUES(%s,%s) ON CONFLICT DO NOTHING', (run_id,session_id))
            count = 0
            for payload, in db.execute('SELECT payload FROM diting_metrics.samples WHERE run_id=%s ORDER BY seq', (run_id,)).fetchall():
                project(db, json.loads(payload))
                count += 1
        return count

    def project_record(self, db, row):
        project(db, row)
