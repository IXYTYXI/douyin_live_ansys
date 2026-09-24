import os
import uuid
import tempfile
import unittest
from pathlib import Path
from backend.pipeline import Pipeline
from backend.asr import ASRError

@unittest.skipUnless(os.getenv("ASR_DATABASE_URL"), "requires PostgreSQL test database")
class CapacityTest(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.business='test_' + uuid.uuid4().hex
        self.p=Pipeline(Path(self.tmp.name),max_inflight=1,business=self.business)
        with self.p.db() as db:
            db.execute("INSERT INTO sessions VALUES ('s',0)")
            for i in range(2):
                db.execute('INSERT INTO segments(id,recording_id,session_id,start,"end",audio) VALUES (%s,%s,%s,%s,%s,%s)',(str(i),'r','s',i,i+1,str(i)+'.wav'))
    def tearDown(self): self.tmp.cleanup()
    def test_inflight_cap_and_stable_audio_url(self):
        class Provider:
            def submit(self,*a): pass
            def poll(self,*a): return None
        self.p.step(Provider(),lambda name:'https://example/'+name,now=100)
        self.assertFalse(self.p.step(Provider(),lambda name:'unused',now=101))
        self.p.step(Provider(),lambda name:'unused',now=106)
        with self.p.db() as db:
            self.assertEqual(db.execute("SELECT count(*) FROM segments WHERE state='submitted'").fetchone()['count'],1)
    def test_throttle_pauses_whole_queue(self):
        class Provider:
            def submit(self,*a): raise ASRError('limited',retry_after=60)
        self.p.step(Provider(),lambda name:'https://example/'+name,now=100)
        self.assertFalse(self.p.step(Provider(),lambda name:'unused',now=120))
        with self.p.db() as db:
            self.assertEqual(db.execute("SELECT attempts FROM segments WHERE id='0'").fetchone()['attempts'],1)
    def test_permanent_error_stops_task(self):
        class Provider:
            def submit(self,*a): raise ASRError('unauthorized',retryable=False)
        self.p.step(Provider(),lambda name:'url',now=100)
        self.assertEqual(self.p.review('s')['segments'][0]['state'],'failed')
    def test_namespace_cannot_change_on_existing_database(self):
        other=Pipeline(Path(self.tmp.name),business='other_' + uuid.uuid4().hex)
        with self.assertRaises(KeyError): other.review('s')
    def test_ambiguous_submit_reuses_original_signed_url(self):
        seen=[]
        class Provider:
            def submit(self,key,url):
                seen.append(url)
                if len(seen)==1: raise TimeoutError()
        self.p.step(Provider(),lambda name:'https://example/original',now=100)
        self.p.step(Provider(),lambda name:'https://example/changed',now=120)
        self.assertEqual(seen,['https://example/original','https://example/original'])
