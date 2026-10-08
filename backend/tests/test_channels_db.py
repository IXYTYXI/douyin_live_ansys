"""Run only against a separately created database, never a deployed database."""
import os,unittest,uuid
from pathlib import Path
import psycopg
from psycopg.conninfo import conninfo_to_dict
from backend.live import LiveStore
from backend.metrics import MetricsStore

@unittest.skipUnless(os.environ.get('CHANNEL_TEST_DSN'),'dedicated PostgreSQL required')
class ChannelDatabaseTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.dsn=os.environ['CHANNEL_TEST_DSN']
        if not conninfo_to_dict(cls.dsn)['dbname'].startswith('diting_channel_test_'):raise RuntimeError('not a dedicated test database')
        cls.store=LiveStore(cls.dsn)
        with cls.store.connect() as db:
            for name in ('001_metrics.sql','005_live.sql','006_channels.sql'):
                db.execute((Path(__file__).resolve().parents[1]/'migrations'/name).read_text())

    def test_fixed_binding_reconnect_new_show_and_retry(self):
        store=self.store;teacher='test-'+uuid.uuid4().hex
        channel=store.bind_channel(teacher)
        self.assertEqual(channel,store.bind_channel(teacher))
        sid=store.register_segment(channel['id'],'first.mp4',1000)
        store.finish_segment(channel['id'],'first.mp4',1060)
        self.assertEqual(sid,store.register_segment(channel['id'],'first.mp4',1000))
        second=store.register_segment(channel['id'],'second.mp4',1180)
        self.assertEqual(sid,second)
        store.finish_segment(channel['id'],'second.mp4',1200)
        third=store.register_segment(channel['id'],'third.mp4',1320.01)
        self.assertNotEqual(third['id'],sid['id'])
        self.assertEqual(sid,store.register_segment(channel['id'],'first.mp4',1000))
        sessions={s['id']:s for s in store.sessions()}
        self.assertFalse(sessions[sid['id']]['live'])
        self.assertTrue(sessions[third['id']]['live'])
        other=store.bind_channel('other-'+teacher)
        self.assertNotEqual(sid['id'],store.register_segment(other['id'],'first.mp4',1000)['id'])

    def test_metrics_join_late_upload_and_new_run_but_not_another_teacher(self):
        from datetime import datetime,timezone
        teacher='metrics-'+uuid.uuid4().hex;channel=self.store.bind_channel(teacher)
        meta={'channelId':channel['id'],'teacher':teacher}
        self.assertEqual(self.store.sample_rows(meta,1000,60),[])
        rows=[]
        for stamp,name in [(1001,teacher),(1011,teacher),(1012,'other'),(900,teacher),(1200,teacher)]:
            rows.append({'id':str(uuid.uuid4()),'runId':str(uuid.uuid4()),'teacher':name,'capturedAt':datetime.fromtimestamp(stamp,timezone.utc).isoformat(),'metrics':{'online':{'value':12}}})
        MetricsStore(self.dsn).accept({'schema':1,'batchId':str(uuid.uuid4()),'records':rows})
        values=self.store.sample_rows(meta,1000,60)
        self.assertEqual([float(r[0]) for r in values],[1,11])

    def test_concurrent_binding_returns_same_channel(self):
        from concurrent.futures import ThreadPoolExecutor
        teacher='parallel-'+uuid.uuid4().hex
        with ThreadPoolExecutor(max_workers=4) as pool:
            channels=list(pool.map(self.store.bind_channel,[teacher]*4))
        self.assertEqual(len({c['id'] for c in channels}),1)
