import os,unittest,uuid
from backend.metrics import MetricsStore,Conflict
from psycopg.conninfo import conninfo_to_dict

@unittest.skipUnless(os.getenv('FINISH_TEST_DSN'),'dedicated PostgreSQL required')
class FinishDatabaseTests(unittest.TestCase):
 def test_count_idempotence_and_sealed_run(self):
  dsn=os.environ['FINISH_TEST_DSN'];self.assertTrue(conninfo_to_dict(dsn)['dbname'].startswith('diting_finish_test_'))
  store=MetricsStore(dsn);store.migrate();run=uuid.uuid4().hex
  row={'id':uuid.uuid4().hex,'runId':run,'teacher':'测试','capturedAt':'2026-10-08T00:00:00Z','metrics':{'online':{'value':5}}}
  batch={'schema':1,'batchId':uuid.uuid4().hex,'records':[row]}
  event={'schema':1,'kind':'finish','runId':run,'teacher':'测试','expectedCount':1,'lastCapturedAt':row['capturedAt'],'endedAt':'2026-10-08T00:00:05Z','reason':'manual'}
  with self.assertRaises(Conflict):store.accept(event)
  store.accept(batch);ack=store.accept(event);self.assertTrue(ack['verified']);self.assertEqual(ack,store.accept(event));store.accept(batch)
  with self.assertRaises(Conflict):store.accept({**event,'expectedCount':2})
  with self.assertRaises(Conflict):store.accept({**batch,'batchId':uuid.uuid4().hex,'records':[{**row,'id':uuid.uuid4().hex}]})
 def test_legacy_is_not_verified(self):
  store=MetricsStore(os.environ['FINISH_TEST_DSN']);store.migrate()
  self.assertFalse(store.accept({'schema':1,'kind':'finish','runId':uuid.uuid4().hex,'teacher':'测试','expectedCount':None,'lastCapturedAt':None,'endedAt':'2026-10-08T00:00:05Z','reason':'manual'})['verified'])

 def test_platform_end_uses_same_verification_and_seals_run(self):
  store=MetricsStore(os.environ['FINISH_TEST_DSN']);store.migrate();run=uuid.uuid4().hex
  row={'id':uuid.uuid4().hex,'runId':run,'teacher':'测试','capturedAt':'2026-10-09T00:00:00Z','metrics':{'online':{'value':5}}}
  event={'schema':1,'kind':'finish','runId':run,'teacher':'测试','expectedCount':1,'lastCapturedAt':row['capturedAt'],'endedAt':'2026-10-09T00:01:00Z','reason':'platform-ended'}
  with self.assertRaises(Conflict):store.accept(event)
  store.accept({'schema':1,'batchId':uuid.uuid4().hex,'records':[row]})
  self.assertTrue(store.accept(event)['verified']);self.assertTrue(store.accept(event)['verified'])
  with self.assertRaises(ValueError):store.accept({**event,'reason':'timeout'})
