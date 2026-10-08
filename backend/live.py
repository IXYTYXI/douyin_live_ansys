"""Explicit collector-run identity and stream timestamps shared by live services."""
import hashlib
import hmac
import re
import uuid
from .metrics import MetricsStore


def run_id(value):
    try:
        return isinstance(value,str) and str(uuid.UUID(value)) == value
    except (ValueError, AttributeError):
        return False


def stream_password(secret, run):
    if not run_id(run):raise ValueError('invalid run')
    return hmac.new(secret.encode(),('publish:'+run).encode(),hashlib.sha256).hexdigest()


def valid_publish(secret, payload):
    return (isinstance(payload,dict) and run_id(payload.get('path')) and
            payload.get('action')=='publish' and payload.get('protocol')=='rtmp' and
            payload.get('user')=='diting' and isinstance(payload.get('password'),str) and
            hmac.compare_digest(payload['password'],stream_password(secret,payload['path'])))


def segment_stamp(name):
    m=re.fullmatch(r'(\d{10})-(\d{6})\.mp4',name)
    if not m:raise ValueError('invalid recording filename')
    return int(m[1])+int(m[2])/1e6


def analysis_windows(duration, live):
    from .summary_worker import windows
    if not live:return windows(duration)
    return sorted({(a,a+step) for step in (600,1800) for a in range(0,int(duration),step) if a+step<=duration})


class LiveStore(MetricsStore):
    def runs(self):
        with self.connect() as db:
            rows=db.execute("SELECT run_id,min(captured_at),max(captured_at),(array_agg(payload::jsonb->>'teacher' ORDER BY seq DESC))[1] FROM diting_metrics.samples WHERE captured_at>now()-interval '24 hours' AND run_id~'^[0-9a-f-]{36}$' GROUP BY run_id ORDER BY max(captured_at) DESC LIMIT 50").fetchall()
        return [{'runId':r,'startedAt':a.isoformat(),'lastAt':b.isoformat(),'teacher':t} for r,a,b,t in rows]

    def teacher(self,run):
        if not run_id(run):raise ValueError('invalid run')
        with self.connect() as db:
            row=db.execute("SELECT payload::jsonb->>'teacher' FROM diting_metrics.samples WHERE run_id=%s ORDER BY seq LIMIT 1",(run,)).fetchone()
        if not row:raise ValueError('upload a sample before starting OBS')
        return row[0]

    def register(self,run,stamp):
        teacher=self.teacher(run)
        with self.connect() as db:
            db.execute('INSERT INTO diting_live.sessions(id,run_id,teacher,started) VALUES(%s,%s,%s,%s) ON CONFLICT(id) DO NOTHING',('live-'+run,run,teacher,stamp))
            return db.execute('SELECT started FROM diting_live.sessions WHERE id=%s',('live-'+run,)).fetchone()[0]

    def sessions(self):
        with self.connect() as db:
            rows=db.execute('SELECT id,run_id,teacher,started,live FROM diting_live.sessions ORDER BY started DESC').fetchall()
        return [dict(zip(('id','runId','teacher','started','live'),r)) for r in rows]


def continuation_offset(wall_offset, previous_end):
    # A sender may buffer packets before publication. Subsequent filenames use wall time,
    # while finalized segments describe media time; do not overlap consecutive media.
    return previous_end if wall_offset<=previous_end+1 else wall_offset
