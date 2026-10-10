import unittest
from backend.readiness import analysis_ready_at,review_readiness
class ReadinessTests(unittest.TestCase):
 def data(self):return {'duration':60,'startedAtUnix':1000,'live':False,'samples':[],'segments':[{'start':0,'end':60,'state':'done','audio_quality':{'version':1,'duration':60,'lowVolumeRanges':[]}}],'recordings':[{'start':0,'duration':60}], 'collectorConfirmed':False}
 def test_live_never_bypasses_missing_metrics(self):
  self.assertEqual(analysis_ready_at({**self.data(),'live':True},9999),0)
 def test_stop_grace_is_bounded(self):
  self.assertEqual(analysis_ready_at(self.data(),1359),0)
  self.assertEqual(analysis_ready_at(self.data(),1360),60)
 def test_missing_metrics_cannot_be_fully_verified(self):
  d={**self.data(),'analysisReadyAt':60}
  result=review_readiness(d,[{'start':0,'end':60,'status':'done'}])
  self.assertEqual(result['state'],'ready_with_gaps')
 def test_failed_asr_never_ready(self):
  d={**self.data(),'segments':[{'start':0,'end':60,'state':'failed'}]}
  self.assertEqual(review_readiness(d,[])['state'],'attention')
 def test_only_complete_confirmed_input_is_ready(self):
  d={**self.data(),'analysisReadyAt':60,'collectorConfirmed':True,'samples':[{'t':i,'value':10} for i in range(0,60,10)]}
  self.assertEqual(review_readiness(d,[{'start':0,'end':60,'status':'done'}])['state'],'ready')
 def test_missing_middle_audio_is_not_hidden_by_final_end(self):
  d={**self.data(),'analysisReadyAt':60,'recordings':[{'start':0,'duration':20},{'start':40,'duration':20}]}
  self.assertEqual(review_readiness(d,[{'start':0,'end':60,'status':'done'}])['state'],'ready_with_gaps')

 def test_silent_audio_is_attention_even_while_streaming(self):
  d=self.data();d['live']=True;d['segments'][0]['audio_quality']['lowVolumeRanges']=[[0,60]]
  self.assertEqual(review_readiness(d,[])['state'],'attention')
 def test_unchecked_audio_is_not_confirmed_normal(self):
  d=self.data();d['segments'][0].pop('audio_quality');d.update(analysisReadyAt=60,collectorConfirmed=True,samples=[{'t':i,'value':10} for i in range(0,60,10)])
  self.assertNotEqual(review_readiness(d,[{'start':0,'end':60,'status':'done'}])['state'],'ready')
