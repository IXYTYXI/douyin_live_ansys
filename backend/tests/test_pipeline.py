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


class FlowTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.audio = self.root / 'input.wav'
        with wave.open(str(self.audio), 'wb') as out:
            out.setparams((1, 2, 16000, 0, 'NONE', 'not compressed'))
            out.writeframes(b'\0\0' * 16000 * 3)
        self.p = Pipeline(self.root / 'data')

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
        self.p = Pipeline(self.root / 'data')
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
