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


RECONNECT_SECONDS=120


def stream_path(value):
    return run_id(value) or (isinstance(value,str) and value.startswith('channel-') and run_id(value[8:]))


def resume_session(media_end, stamp):
    return media_end is not None and stamp <= media_end + RECONNECT_SECONDS


def stream_password(secret, run):
    if not stream_path(run):raise ValueError('invalid stream path')
    return hmac.new(secret.encode(),('publish:'+run).encode(),hashlib.sha256).hexdigest()


def valid_publish(secret, payload):
    return (isinstance(payload,dict) and stream_path(payload.get('path')) and
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
            rows=db.execute('SELECT id,run_id,teacher,started,live,channel_id FROM diting_live.sessions ORDER BY started DESC').fetchall()
        return [dict(zip(('id','runId','teacher','started','live','channelId'),r)) for r in rows]

    def channels(self):
        with self.connect() as db:
            rows=db.execute("SELECT teacher FROM diting_live.channels UNION SELECT DISTINCT payload::jsonb->>'teacher' FROM diting_metrics.samples ORDER BY 1").fetchall()
        return [{'teacher':r[0]} for r in rows if r[0]]

    def bind_channel(self, teacher):
        if not isinstance(teacher,str) or not teacher.strip() or len(teacher)>60:raise ValueError('invalid teacher')
        teacher=teacher.strip()
        with self.connect() as db:
            row=db.execute("INSERT INTO diting_live.channels(id,teacher) VALUES(%s,%s) ON CONFLICT(teacher) DO UPDATE SET teacher=EXCLUDED.teacher RETURNING id,teacher",('channel-'+str(uuid.uuid4()),teacher)).fetchone()
        return {'id':row[0],'teacher':row[1]}

    def channel_teacher(self, channel):
        if not stream_path(channel) or not channel.startswith('channel-'):raise ValueError('invalid channel')
        with self.connect() as db:
            row=db.execute('SELECT teacher FROM diting_live.channels WHERE id=%s',(channel,)).fetchone()
        if not row:raise ValueError('unknown channel')
        return row[0]

    def register_segment(self, channel, name, stamp):
        # The channel row serializes session allocation; the file mapping makes retries idempotent.
        with self.connect() as db:
            teacher=db.execute('SELECT teacher FROM diting_live.channels WHERE id=%s FOR UPDATE',(channel,)).fetchone()
            if not teacher:raise ValueError('unknown channel')
            old=db.execute('SELECT s.id,s.started FROM diting_live.segments f JOIN diting_live.sessions s ON s.id=f.session_id WHERE f.channel_id=%s AND f.name=%s',(channel,name)).fetchone()
            if old:return {'id':old[0],'started':old[1]}
            prev=db.execute('SELECT id,started,media_end FROM diting_live.sessions WHERE channel_id=%s ORDER BY started DESC LIMIT 1',(channel,)).fetchone()
            if prev and stamp<prev[1]:raise ValueError('out of order segment')
            if prev and resume_session(prev[2],stamp):
                sid,start=prev[:2]
                db.execute('UPDATE diting_live.sessions SET live=true WHERE id=%s',(sid,))
            else:
                sid='live-'+str(uuid.uuid4());start=stamp
                db.execute('UPDATE diting_live.sessions SET live=false WHERE channel_id=%s',(channel,))
                db.execute('INSERT INTO diting_live.sessions(id,run_id,teacher,started,channel_id,media_end) VALUES(%s,%s,%s,%s,%s,%s)',(sid,sid[5:],teacher[0],start,channel,start))
            db.execute('INSERT INTO diting_live.segments(channel_id,name,session_id) VALUES(%s,%s,%s)',(channel,name,sid))
            return {'id':sid,'started':start}

    def finish_segment(self, channel, name, end):
        with self.connect() as db:
            db.execute('UPDATE diting_live.sessions SET media_end=greatest(media_end,%s) WHERE id=(SELECT session_id FROM diting_live.segments WHERE channel_id=%s AND name=%s)',(end,channel,name))

    def sample_rows(self, meta, start, duration):
        with self.connect() as db:
            if meta.get('channelId'):
                # Late uploads and collector restarts join by bound teacher and capture time.
                return db.execute("SELECT extract(epoch FROM captured_at)-%s,payload::json FROM diting_metrics.samples WHERE payload::jsonb->>'teacher'=%s AND captured_at>=to_timestamp(%s) AND captured_at<to_timestamp(%s) ORDER BY captured_at,seq",(start,meta['teacher'],start,start+duration+15)).fetchall()
            return db.execute('SELECT extract(epoch FROM captured_at)-%s,payload::json FROM diting_metrics.samples WHERE run_id=%s AND captured_at>=to_timestamp(%s) AND captured_at<to_timestamp(%s) ORDER BY captured_at',(start,meta['runId'],start,start+duration+15)).fetchall()


def continuation_offset(wall_offset, previous_end):
    # A sender may buffer packets before publication. Subsequent filenames use wall time,
    # while finalized segments describe media time; do not overlap consecutive media.
    return previous_end if wall_offset<=previous_end+1 else wall_offset
