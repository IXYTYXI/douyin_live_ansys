import unittest
from backend.collection_status import processing_status
class StatusTests(unittest.TestCase):
 def test_counts_do_not_call_queued_segments_complete(self):
  result=processing_status({'segments':[{'state':'done'},{'state':'pending'},{'state':'failed','error':'secret URL'}],'recordings':[{}]},[{'status':'done'}])
  self.assertEqual(result['asr'],{'done':1,'pending':1,'failed':1})
  self.assertNotIn('secret',str(result))
 def test_empty_is_empty_not_success(self):
  self.assertEqual(processing_status({},[])['asr'],{})
