import unittest
from backend.collection_status import processing_status
class StatusTests(unittest.TestCase):
 def test_counts_do_not_call_queued_segments_complete(self):
  result=processing_status({'segments':[{'state':'done'},{'state':'pending'},{'state':'failed','error':'secret URL'}],'recordings':[{}]},[{'status':'done'}])
  self.assertEqual(result['asr'],{'done':1,'pending':1,'failed':1})
  self.assertNotIn('secret',str(result))
 def test_empty_is_empty_not_success(self):
  self.assertEqual(processing_status({},[])['asr'],{})

class FinishTests(unittest.TestCase):
 def test_unseen_tail_never_claims_whole_live_complete(self):
  from backend.collection_status import finishing_status
  result=finishing_status({'live':False,'duration':600,'analysisReadyAt':400,'segments':[{'state':'done'}],'recordings':[{}]},[])
  self.assertTrue(any('人数' in s for s in result))
  self.assertTrue(any('插件' in s for s in result))
