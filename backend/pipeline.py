"""Durable chunk-level ASR queue. All times are seconds from actual live start."""
import hashlib
import json
import math
import random
from .asr import ASRError
import os
import re
import shutil
import sqlite3
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
    def __init__(self, root, business='douyin', max_inflight=2, poll_seconds=5):
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
        with self.db() as db:
            db.executescript('''
            CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY, started REAL NOT NULL);
            CREATE TABLE IF NOT EXISTS recordings(id TEXT PRIMARY KEY, session_id TEXT NOT NULL,
              start REAL NOT NULL, duration REAL NOT NULL, media TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS segments(id TEXT PRIMARY KEY, recording_id TEXT NOT NULL,
              session_id TEXT NOT NULL, start REAL NOT NULL, end REAL NOT NULL, audio TEXT NOT NULL,
              state TEXT NOT NULL DEFAULT 'queued', text TEXT, attempts INTEGER NOT NULL DEFAULT 0,
              next_at REAL NOT NULL DEFAULT 0, owner TEXT, lease REAL NOT NULL DEFAULT 0,
              submitted_at REAL, error TEXT);
            CREATE INDEX IF NOT EXISTS queue_due ON segments(state,next_at,lease);
            ''')
            db.execute("INSERT OR IGNORE INTO settings VALUES ('business',?)", (business,))
            if db.execute("SELECT value FROM settings WHERE key='business'").fetchone()[0] != business:
                raise ValueError('business namespace differs; use a separate DATA_DIR')
            columns = {r[1] for r in db.execute('PRAGMA table_info(segments)')}
            if 'audio_url' not in columns:
                db.execute('ALTER TABLE segments ADD COLUMN audio_url TEXT')

    @contextmanager
    def db(self):
        db = sqlite3.connect(self.root / 'pipeline.sqlite', timeout=30)
        db.row_factory = sqlite3.Row
        try:
            with db:
                yield db
        finally:
            db.close()

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
            db.execute('INSERT OR IGNORE INTO sessions VALUES (?,?)', (session_id, start))
            if db.execute('SELECT started FROM sessions WHERE id=?', (session_id,)).fetchone()[0] != start:
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
                if db.execute('SELECT 1 FROM recordings WHERE id=?', (rid,)).fetchone():
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
                db.execute('INSERT OR IGNORE INTO recordings VALUES (?,?,?,?,?)',
                           (rid, session_id, offset, local, media))
                db.executemany('INSERT OR IGNORE INTO segments(id,recording_id,session_id,start,end,audio) VALUES (?,?,?,?,?,?)', chunks)
            return rid

    def step(self, provider, audio_url, now=None):
        now = time.time() if now is None else now
        owner = uuid.uuid4().hex
        with self.db() as db:
            db.execute('BEGIN IMMEDIATE')
            cooldown = db.execute("SELECT value FROM settings WHERE key='cooldown'").fetchone()
            if cooldown and float(cooldown[0]) > now:
                return False
            active = db.execute("SELECT count(*) FROM segments WHERE state='submitted' OR (state='queued' AND (lease>? OR attempts>0))", (now,)).fetchone()[0]
            row = db.execute("SELECT * FROM segments WHERE state IN ('queued','submitted') AND next_at<=? AND lease<=? AND (state='submitted' OR attempts>0 OR ? < ?) ORDER BY CASE WHEN state='submitted' THEN 0 ELSE 1 END,start LIMIT 1", (now, now, active, self.max_inflight)).fetchone()
            if row is None:
                return False
            stable_url = row['audio_url'] or audio_url(row['audio'])
            db.execute('UPDATE segments SET owner=?,lease=?,audio_url=? WHERE id=?', (owner, now + 180, stable_url, row['id']))
        state, text, attempts, error = row['state'], row['text'], row['attempts'], None
        submitted_at = row['submitted_at']
        delay = self.poll_seconds
        cooldown_until = 0
        try:
            if state == 'queued':
                # Deterministic request id lets an idempotent upstream deduplicate ambiguous retries.
                provider.submit(row['id'], stable_url)
                state, submitted_at = 'submitted', now
            else:
                if now - submitted_at > 86400:
                    state, error = 'failed', 'ASR task exceeded 24 hours'
                else:
                    text = provider.poll(row['id'])
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
                db.execute("INSERT INTO settings VALUES ('cooldown',?) ON CONFLICT(key) DO UPDATE SET value=max(CAST(value AS REAL),CAST(excluded.value AS REAL))", (str(cooldown_until),))
            db.execute('UPDATE segments SET state=?,text=?,attempts=?,next_at=?,submitted_at=?,error=?,owner=NULL,lease=0 WHERE id=? AND owner=?',
                       (state, text, attempts, now + delay, submitted_at, error, row['id'], owner))
        return True

    def retry(self, session_id):
        with self.db() as db:
            db.execute("UPDATE segments SET state=CASE WHEN submitted_at IS NULL THEN 'queued' ELSE 'submitted' END, attempts=0,next_at=0,error=NULL WHERE session_id=? AND state='failed'", (session_id,))

    def review(self, session_id, start=0, end=1e12):
        if not math.isfinite(start) or not math.isfinite(end) or start < 0 or end <= start:
            raise ValueError('invalid interval')
        with self.db() as db:
            session = db.execute('SELECT * FROM sessions WHERE id=?', (session_id,)).fetchone()
            if session is None:
                raise KeyError(session_id)
            rows = db.execute('SELECT id,recording_id,start,end,state,text,attempts,error FROM segments WHERE session_id=? AND start<? AND end>? ORDER BY start', (session_id, end, start)).fetchall()
            recordings = db.execute('SELECT id,start,duration,media FROM recordings WHERE session_id=? ORDER BY start', (session_id,)).fetchall()
        return {'sessionId': session_id, 'startedAtUnix': session['started'], 'timeUnit': 'seconds',
                'segments': [dict(r, timing='chunk') for r in rows],
                'recordings': [dict(r) for r in recordings]}
