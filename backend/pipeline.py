"""Durable chunk-level ASR queue. All times are seconds from actual live start."""
import hashlib
import json
import math
import random
from .asr import ASRError
import os
import re
import shutil
import psycopg
from psycopg import sql
from psycopg.rows import dict_row
import subprocess
import tempfile
import time
import uuid
import wave
from contextlib import contextmanager
from datetime import datetime
from pathlib import Path


def timestamp(value):
    dt = datetime.fromisoformat(value)
    if dt.tzinfo is None:
        raise ValueError('timestamps must include a timezone')
    return dt.timestamp()


class Pipeline:
    def __init__(self, root, business='douyin', max_inflight=2, poll_seconds=5, database_url=None):
        if not re.fullmatch(r'[A-Za-z0-9_-]{1,40}', business):
            raise ValueError('invalid business namespace')
        if not isinstance(max_inflight,int) or not 1 <= max_inflight <= 100:
            raise ValueError('max_inflight must be 1..100')
        if not 1 <= poll_seconds <= 300:
            raise ValueError('poll_seconds must be 1..300')
        self.business, self.max_inflight, self.poll_seconds = business, max_inflight, poll_seconds
        self.root = Path(root).resolve()
        self.root.mkdir(parents=True, exist_ok=True)
        (self.root / 'media').mkdir(exist_ok=True)
        self.database_url = database_url or os.getenv('ASR_DATABASE_URL')
        if not self.database_url:
            raise ValueError('ASR_DATABASE_URL is required; SQLite is no longer used')
        self.schema = 'diting_asr_' + business.replace('-', '_')
        with self.db(initialize=True) as db:
            db.execute((Path(__file__).parent / 'migrations/002_asr.sql').read_text())
            db.execute('ALTER TABLE segments ADD COLUMN IF NOT EXISTS task_id TEXT')
            db.execute('ALTER TABLE segments ADD COLUMN IF NOT EXISTS utterances JSONB')
            db.execute("INSERT INTO settings VALUES ('business',%s) ON CONFLICT DO NOTHING", (business,))
            if db.execute("SELECT value FROM settings WHERE key='business'").fetchone()['value'] != business:
                raise ValueError('business namespace differs')

    @contextmanager
    def db(self, initialize=False):
        with psycopg.connect(self.database_url, row_factory=dict_row, client_encoding='utf8', connect_timeout=10) as db:
            if initialize:
                db.execute(sql.SQL('CREATE SCHEMA IF NOT EXISTS {}').format(sql.Identifier(self.schema)))
            db.execute(sql.SQL('SET LOCAL search_path TO {}').format(sql.Identifier(self.schema)))
            db.execute("SET LOCAL lock_timeout = '15s'")
            db.execute("SET LOCAL statement_timeout = '30s'")
            yield db

    def ingest(self, session_id, started_at, recorded_at, source, chunk_seconds=45):
        if not re.fullmatch(r'[A-Za-z0-9_-]{1,100}', session_id):
            raise ValueError('invalid session id')
        if not isinstance(chunk_seconds, int) or not 1 <= chunk_seconds <= 60:
            raise ValueError('chunk_seconds must be 1..60')
        start = timestamp(started_at)
        offset = timestamp(recorded_at) - start
        if offset < 0:
            raise ValueError('recording must not precede the live start')
        source = Path(source).resolve(strict=True)
        with self.db() as db:
            db.execute('INSERT INTO sessions VALUES (%s,%s) ON CONFLICT DO NOTHING', (session_id, start))
            if db.execute('SELECT started FROM sessions WHERE id=%s', (session_id,)).fetchone()['started'] != start:
                raise ValueError('session start conflicts with existing session')
        # Take an immutable copy of a COMPLETED recording, never process a growing OBS file.
        with tempfile.TemporaryDirectory(dir=self.root) as folder:
            folder = Path(folder)
            copied = folder / ('recording' + source.suffix.lower())
            shutil.copyfile(source, copied)
            with copied.open('rb') as handle:
                digest = hashlib.file_digest(handle, 'sha256').hexdigest()
            rid = hashlib.sha256(f'{self.business}:{session_id}:{offset}:{digest}'.encode()).hexdigest()
            with self.db() as db:
                if db.execute('SELECT 1 FROM recordings WHERE id=%s', (rid,)).fetchone():
                    return rid
            wav = folder / 'audio.wav'
            subprocess.run(['ffmpeg', '-nostdin', '-hide_banner', '-loglevel', 'error', '-y',
                            '-i', str(copied), '-map', '0:a:0', '-vn', '-ac', '1', '-ar', '16000',
                            '-c:a', 'pcm_s16le', str(wav)], check=True, capture_output=True, timeout=300)
            chunks, local = [], 0.0
            with wave.open(str(wav), 'rb') as audio:
                while pcm := audio.readframes(chunk_seconds * 16000):
                    duration = len(pcm) / 32000
                    key = hashlib.sha256(f'{rid}:{local:.6f}'.encode()).hexdigest()
                    name = key + '.wav'
                    target = folder / name
                    with wave.open(str(target), 'wb') as out:
                        out.setparams((1, 2, 16000, 0, 'NONE', 'not compressed'))
                        out.writeframes(pcm)
                    os.replace(target, self.root / 'media' / name)
                    chunks.append((key, rid, session_id, offset + local, offset + local + duration, name))
                    local += duration
            if not chunks:
                raise ValueError('recording contains no audio')
            media = rid + copied.suffix
            os.replace(copied, self.root / 'media' / media)
            with self.db() as db:
                db.execute('INSERT INTO recordings VALUES (%s,%s,%s,%s,%s) ON CONFLICT DO NOTHING',
                           (rid, session_id, offset, local, media))
                db.cursor().executemany('INSERT INTO segments(id,recording_id,session_id,start,"end",audio) VALUES (%s,%s,%s,%s,%s,%s) ON CONFLICT DO NOTHING', chunks)
            return rid

    def step(self, provider, audio_url, now=None):
        now = time.time() if now is None else now
        owner = uuid.uuid4().hex
        with self.db() as db:
            db.execute('SELECT pg_advisory_xact_lock(hashtext(%s))', (self.schema,))
            cooldown = db.execute("SELECT value FROM settings WHERE key='cooldown'").fetchone()
            if cooldown and float(cooldown['value']) > now:
                return False
            active = db.execute("SELECT count(*) AS count FROM segments WHERE state='submitted' OR (state='queued' AND (lease>%s OR attempts>0))", (now,)).fetchone()['count']
            row = db.execute("SELECT * FROM segments WHERE state IN ('queued','submitted') AND next_at<=%s AND lease<=%s AND (state='submitted' OR attempts>0 OR %s < %s) ORDER BY CASE WHEN state='submitted' THEN 0 ELSE 1 END,start LIMIT 1", (now, now, active, self.max_inflight)).fetchone()
            if row is None:
                return False
            stable_url = row['audio_url'] or audio_url(row['audio'])
            db.execute('UPDATE segments SET owner=%s,lease=%s,audio_url=%s WHERE id=%s', (owner, now + 180, stable_url, row['id']))
        state, text, attempts, error = row['state'], row['text'], row['attempts'], None
        utterances = row['utterances']
        submitted_at = row['submitted_at']
        task_id = row['task_id'] or str(uuid.uuid5(uuid.NAMESPACE_URL, self.business + ':' + row['id']))
        delay = self.poll_seconds
        cooldown_until = 0
        try:
            if state == 'queued':
                # Deterministic request id lets an idempotent upstream deduplicate ambiguous retries.
                provider.submit(task_id, stable_url)
                state, submitted_at = 'submitted', now
            else:
                if now - submitted_at > 86400:
                    state, error = 'failed', 'ASR task exceeded 24 hours'
                else:
                    result = provider.poll(task_id)
                    text = result
                    if isinstance(result, dict):
                        text = result.get('text')
                        utterances = normalize_utterances(result, row['end']-row['start'])
                    if text is not None:
                        if not isinstance(text, str):
                            raise ValueError('ASR result.text must be a string')
                        state = 'done'
        except Exception as exc:
            attempts += 1
            # Do not persist response bodies, credentials, audio URLs, or provider secrets.
            error = type(exc).__name__
            delay = min(300, 2 ** attempts * 5) + random.uniform(0, 3)
            if isinstance(exc, ASRError):
                if not exc.retryable:
                    state = 'failed'
                if exc.retry_after is not None:
                    delay = max(delay, exc.retry_after)
                    cooldown_until = now + delay
            if attempts >= 5:
                state = 'failed'
        with self.db() as db:
            if cooldown_until:
                db.execute("INSERT INTO settings VALUES ('cooldown',%s) ON CONFLICT(key) DO UPDATE SET value=GREATEST(CAST(settings.value AS DOUBLE PRECISION),CAST(excluded.value AS DOUBLE PRECISION))::text", (str(cooldown_until),))
            db.execute('UPDATE segments SET state=%s,text=%s,utterances=%s::jsonb,attempts=%s,next_at=%s,submitted_at=%s,error=%s,owner=NULL,lease=0 WHERE id=%s AND owner=%s',
                       (state, text, json.dumps(utterances), attempts, now + delay, submitted_at, error, row['id'], owner))
        return True

    def retry(self, session_id):
        with self.db() as db:
            db.execute("UPDATE segments SET state=CASE WHEN submitted_at IS NULL THEN 'queued' ELSE 'submitted' END, attempts=0,next_at=0,error=NULL WHERE session_id=%s AND state='failed'", (session_id,))

    def review(self, session_id, start=0, end=1e12):
        if not math.isfinite(start) or not math.isfinite(end) or start < 0 or end <= start:
            raise ValueError('invalid interval')
        with self.db() as db:
            session = db.execute('SELECT * FROM sessions WHERE id=%s', (session_id,)).fetchone()
            if session is None:
                raise KeyError(session_id)
            rows = db.execute('SELECT id,recording_id,start,"end",state,text,utterances,attempts,error FROM segments WHERE session_id=%s AND start<%s AND "end">%s ORDER BY start', (session_id, end, start)).fetchall()
            recordings = db.execute('SELECT id,start,duration,media FROM recordings WHERE session_id=%s ORDER BY start', (session_id,)).fetchall()
        return {'sessionId': session_id, 'startedAtUnix': session['started'], 'timeUnit': 'seconds',
                'segments': [dict(r, timing='utterance' if r['utterances'] else 'chunk') for r in rows],
                'recordings': [dict(r) for r in recordings]}


def normalize_utterances(result, duration):
    """Validate observed company millisecond timestamps against known audio duration."""
    info = result.get('audio_info') or {}
    reported = info.get('duration')
    if type(reported) not in (int, float) or not math.isfinite(reported) or abs(reported/1000-duration)>1:
        return []
    output=[]
    previous=-1
    items=result.get('utterances')
    if not isinstance(items,list): return []
    for item in items:
        if not isinstance(item,dict): return []
        start,end=item.get('start_time'),item.get('end_time')
        if any(type(v) not in (int,float) or not math.isfinite(v) for v in (start,end)): return []
        if start<0 or end<=start or end>duration*1000+100 or start<previous: return []
        if not isinstance(item.get('text'),str): return []
        output.append({'start':start/1000,'end':min(duration,end/1000),'text':item['text'],'speaker':item.get('speaker') if isinstance(item.get('speaker'),str) else None})
        previous=start
    return output
