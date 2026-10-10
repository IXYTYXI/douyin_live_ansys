import unittest
from unittest.mock import patch
from backend.summary_worker import build_summary_input,summarize_payload

class SummaryAudioTests(unittest.TestCase):
 def data(self):
  return {'segments':[{'start':0,'end':60,'state':'done','text':'','audio_quality':{'version':1,'duration':60,'lowVolumeRanges':[[0,60]]}}],'samples':[]}
 def test_silence_and_empty_asr_are_evidence_not_valid_speech(self):
  p=build_summary_input(self.data(),0,60)
  self.assertEqual(p['audioQuality']['sustainedLowVolumeRanges'],[[0,60]])
  self.assertEqual(p['emptyTranscriptRanges'],[[0,60]])
  self.assertEqual(p['transcript'],[])
 def test_empty_transcript_never_calls_model_to_invent_lesson(self):
  with patch('backend.summary_worker.generate',side_effect=AssertionError('no content to summarize')):
   fields=summarize_payload(build_summary_input(self.data(),0,60))
  self.assertIn('静音或音量极低',fields['conclusion'])
  self.assertEqual(fields['keywords'],[])
 def test_model_cannot_omit_silence_notice_in_partial_window(self):
  d=self.data();d['segments'].append({'start':60,'end':80,'state':'done','text':'真实内容','audio_quality':{'version':1,'duration':20,'lowVolumeRanges':[]}})
  with patch('backend.summary_worker.generate',return_value={'periodTheme':'主题','keywords':[],'conclusion':'模型未说明缺失','adjustment':''}):
   fields=summarize_payload(build_summary_input(d,0,80))
  self.assertIn('静音或音量极低',fields['conclusion'])
