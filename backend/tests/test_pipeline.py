import os
import uuid
import tempfile
import unittest
import wave
from pathlib import Path
from backend.pipeline import Pipeline


class FakeASR:
    def __init__(self):
        self.submissions = []
        self.polls = 0

    def submit(self, task_id, url):
        self.submissions.append((task_id, url))

    def poll(self, task_id):
        self.polls += 1
        return None if self.polls == 1 else '测试文字'


@unittest.skipUnless(os.getenv("ASR_DATABASE_URL"), "requires PostgreSQL test database")
class FlowTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.audio = self.root / 'input.wav'
        with wave.open(str(self.audio), 'wb') as out:
            out.setparams((1, 2, 16000, 0, 'NONE', 'not compressed'))
            out.writeframes(b'\0\0' * 16000 * 3)
        self.business = getattr(self, 'business', 'test_' + uuid.uuid4().hex)
        self.p = Pipeline(self.root / 'data', business=self.business)

    def tearDown(self):
        self.tmp.cleanup()

    def ingest(self):
        return self.p.ingest('lesson1', '2026-09-22T20:00:00+08:00',
                             '2026-09-22T20:02:00+08:00', self.audio, chunk_seconds=2)

    def test_ingest_idempotent_offsets_and_partial_tail(self):
        self.ingest()
        self.ingest()
        result = self.p.review('lesson1')
        self.assertEqual([(x['start'], x['end']) for x in result['segments']], [(120, 122), (122, 123)])
        self.assertEqual(len(result['recordings']), 1)
        self.assertTrue(all(x['text'] is None for x in result['segments']))

    def test_restart_resumes_submitted_without_resubmitting(self):
        self.ingest()
        asr = FakeASR()
        self.p.step(asr, lambda key: 'https://audio.example/' + key, now=100)
        self.business = getattr(self, 'business', 'test_' + uuid.uuid4().hex)
        self.p = Pipeline(self.root / 'data', business=self.business)
        self.p.step(asr, lambda key: 'unused', now=110)
        self.p.step(asr, lambda key: 'unused', now=120)
        self.assertEqual(len(asr.submissions), 1)
        first = self.p.review('lesson1')['segments'][0]
        self.assertEqual(first['text'], '测试文字')
        self.assertEqual(first['timing'], 'chunk')

    def test_interval_filter_and_session_conflict(self):
        self.ingest()
        self.assertEqual(len(self.p.review('lesson1', 122, 123)['segments']), 1)
        with self.assertRaises(ValueError):
            self.p.ingest('lesson1', '2026-09-22T21:00:00+08:00',
                          '2026-09-22T21:02:00+08:00', self.audio)

    def test_retry_does_not_fabricate_transcript(self):
        self.ingest()
        class Broken(FakeASR):
            def submit(self, *_):
                raise TimeoutError('unavailable')
        self.p.step(Broken(), lambda key: 'unused', now=100)
        row = self.p.review('lesson1')['segments'][0]
        self.assertEqual(row['attempts'], 1)
        self.assertIsNone(row['text'])
        self.assertEqual(row['state'], 'queued')

    def test_naive_timestamps_rejected(self):
        with self.assertRaises(ValueError):
            self.p.ingest('lesson1', '2026-09-22T20:00:00',
                          '2026-09-22T20:02:00', self.audio)

    def test_new_provider_request_uses_stable_uuid(self):
        self.ingest()
        provider = FakeASR()
        self.p.step(provider, lambda key: 'https://example.com/' + key, now=100)
        task_id = provider.submissions[0][0]
        self.assertEqual(str(uuid.UUID(task_id)), task_id)
        self.assertFalse((self.p.root / 'pipeline.sqlite').exists())

    def test_readonly_legacy_migration_preserves_submitted_task_id(self):
        import sqlite3
        from backend.migrate_sqlite import migrate
        legacy = self.root / 'old.sqlite'
        with sqlite3.connect(legacy) as db:
            db.executescript('''
                CREATE TABLE settings(key TEXT PRIMARY KEY,value TEXT);
                CREATE TABLE sessions(id TEXT PRIMARY KEY,started REAL);
                CREATE TABLE recordings(id TEXT PRIMARY KEY,session_id TEXT,start REAL,duration REAL,media TEXT);
                CREATE TABLE segments(id TEXT PRIMARY KEY,recording_id TEXT,session_id TEXT,start REAL,end REAL,audio TEXT,state TEXT,submitted_at REAL,audio_url TEXT);
                INSERT INTO sessions VALUES ('s',0);
                INSERT INTO recordings VALUES ('r','s',0,1,'r.mp4');
                INSERT INTO segments VALUES ('old-hash','r','s',0,1,'a.wav','submitted',100,'https://example.com/a.wav');
            ''')
            db.execute('INSERT INTO settings VALUES (?,?)', ('business',self.business))
        original=legacy.read_bytes()
        self.assertEqual(migrate(legacy,self.p)['segments'],1)
        seen=[]
        class Provider:
            def poll(self, task):
                seen.append(task)
                return '旧任务继续完成'
        self.p.step(Provider(),lambda key:'unused',now=110)
        self.assertEqual(seen,['old-hash'])
        self.assertEqual(self.p.review('s')['segments'][0]['text'],'旧任务继续完成')
        self.assertEqual(legacy.read_bytes(),original)
        with self.assertRaises(ValueError): migrate(legacy,self.p)
