import copy
import os
import unittest
import uuid
from backend.business import BusinessStore
from backend.metrics import Conflict


@unittest.skipUnless(os.getenv('METRICS_TEST_DATABASE_URL'), 'requires dedicated PostgreSQL')
class BusinessTest(unittest.TestCase):
    def test_unbound_then_bound_backfill_and_atomic_conflict(self):
        store = BusinessStore(os.environ['METRICS_TEST_DATABASE_URL'])
        store.migrate()
        store.migrate()
        run = str(uuid.uuid4())
        row = {'id':str(uuid.uuid4()),'runId':run,'teacher':'测试主播',
               'capturedAt':'2026-09-24T04:27:46Z','gap':False,'foreground':True,
               'metrics':{'online':{'value':48},'likes':{'value':2000},
                          'averageStay':{'value':3.1,'raw':'3.1','unit':None}}}
        batch = {'schema':1,'batchId':str(uuid.uuid4()),'records':[row]}
        store.accept(batch)
        with store.connect() as db:
            self.assertEqual(db.execute('SELECT count(*) FROM diting.capture_snapshots WHERE request_id=%s',(row['id'],)).fetchone()[0],0)
            sid = db.execute("INSERT INTO diting.live_sessions(live_room_id,started_at) VALUES(%s,'2026-09-24T04:00:00Z') RETURNING id",(run,)).fetchone()[0]
        self.assertEqual(store.bind(run,sid),1)
        store.accept(batch)
        store.bind(run,sid)
        with store.connect() as db:
            saved = db.execute('SELECT online_count,likes,average_stay_raw,avg_stay_duration_seconds FROM diting.capture_snapshots WHERE request_id=%s',(row['id'],)).fetchall()
            self.assertEqual(saved,[(48,2000,'3.1',None)])
            self.assertEqual(db.execute('SELECT count(*) FROM diting.online_samples WHERE session_id=%s',(sid,)).fetchone()[0],1)
        bad = copy.deepcopy(row)
        bad['id']=str(uuid.uuid4());bad['capturedAt']='2026-09-24T03:00:00Z'
        with self.assertRaises(Conflict): store.accept({'schema':1,'batchId':str(uuid.uuid4()),'records':[bad]})
        with store.connect() as db:
            self.assertIsNone(db.execute('SELECT 1 FROM diting_metrics.samples WHERE id=%s',(bad['id'],)).fetchone())
