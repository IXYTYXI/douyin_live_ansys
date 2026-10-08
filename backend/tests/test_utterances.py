import unittest
from backend.pipeline import normalize_utterances
class UtteranceTest(unittest.TestCase):
 def test_milliseconds_and_unknown_unit_fallback(self):
  data={'audio_info':{'duration':45000},'utterances':[{'start_time':170,'end_time':7318,'text':'一句','speaker':'A'}]}
  self.assertEqual(normalize_utterances(data,45)[0]['start'],.17)
  data['audio_info']['duration']=45
  self.assertEqual(normalize_utterances(data,45),[])
 def test_out_of_bounds_rejected(self):
  self.assertEqual(normalize_utterances({'audio_info':{'duration':45000},'utterances':[{'start_time':0,'end_time':50000,'text':'坏时间'}]},45),[])
 def test_start_at_or_past_duration_rejected_despite_end_tolerance(self):
  for start in (10000,10050):
   data={'audio_info':{'duration':10000},'utterances':[{'start_time':start,'end_time':10080,'text':'末尾'}]}
   self.assertEqual(normalize_utterances(data,10),[])
 def test_valid_tail_keeps_tolerance_and_positive_interval(self):
  data={'audio_info':{'duration':10000},'utterances':[{'start_time':9950,'end_time':10080,'text':'末尾'}]}
  result=normalize_utterances(data,10)[0]
  self.assertEqual((result['start'],result['end']),(9.95,10))
