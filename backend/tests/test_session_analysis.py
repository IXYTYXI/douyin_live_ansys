import copy
import json
import unittest
from backend.session_analysis import build_payload, validate_output, analysis_row, waiting_reason, input_hash

class AnalysisTests(unittest.TestCase):
    def data(self):
        return {'id':'live-test','teacher':'测试夹具','startedAtUnix':1000,'duration':30,'live':False,
          'collectorConfirmed':True,'samples':[
            {'t':0,'value':0,'metrics':{'online':{'value':0},'likes':{'value':100}}},
            {'t':10,'value':2,'metrics':{'online':{'value':2},'likes':{'value':120}}},
            {'t':20,'value':4,'metrics':{'online':{'value':4},'likes':{'value':2}}}],
          'recordings':[{'start':0,'duration':30}],
          'segments':[{'start':0,'end':30,'state':'done','text':'今天讲分数应用题。'}],
          'notes':[],'summaries':[]}
    def test_counts_not_summed_and_reset_not_reported_as_growth(self):
        p=build_payload(self.data());m=p['metrics']['点赞次数']
        self.assertEqual(m['first']['value'],100);self.assertEqual(m['last']['value'],2)
        self.assertIsNone(m['observedChange']);self.assertEqual(m['decreases'],1)
        self.assertNotIn('sum',m)
    def test_missing_is_not_zero_and_mean_is_sample_mean(self):
        p=build_payload(self.data());self.assertEqual(p['metrics']['在线人数']['sampleMean'],2)
        self.assertEqual(p['metrics']['分享次数']['count'],0)
        self.assertEqual(p['metrics']['分享次数']['gaps'],[[0,30]])
    def test_gap_and_partial_transcript_are_explicit(self):
        d=self.data();d['samples']=d['samples'][:1];d['segments'][0]['end']=10
        p=build_payload(d);self.assertEqual(p['coverage']['transcriptGaps'],[[10,30]])
        self.assertEqual(p['metrics']['在线人数']['gaps'],[[10,30]])
    def test_ai_cannot_choose_a_different_quote_or_timestamp(self):
        p=build_payload(self.data());event=p['eventCandidates'][0]
        out={'overview':'概览','events':[{'id':event['id'],'hypothesis':'待验证'}],'advice':'建议','limitations':'局限'}
        checked=validate_output(out,p)
        self.assertEqual(checked['events'][0]['quote'],event['sourceText'])
        self.assertIn('今天讲分数应用题。',checked['events'][0]['quote'])
        self.assertEqual(checked['events'][0]['observation'],event['observation'])
        for patch in ({'id':'999'},{'quote':'别处原文'},{'start':100}):
            bad=copy.deepcopy(out);bad['events'][0].update(patch)
            with self.assertRaises(ValueError):validate_output(bad,p)
    def test_candidates_exclude_changes_without_transcript(self):
        d=self.data();d['segments'][0]['text']=''
        self.assertEqual(build_payload(d)['eventCandidates'],[])
    def test_late_data_changes_hash_but_transport_metadata_does_not(self):
        d=self.data();p=build_payload(d);h=input_hash(p,'model')
        d['recordings'][0]['url']='sensitive';d['checkedAt']=999
        self.assertEqual(h,input_hash(build_payload(d),'model'))
        d['samples'][0]['metrics']['likes']['value']=101
        self.assertNotEqual(h,input_hash(build_payload(d),'model'))
    def test_no_generation_while_live_or_transcribing(self):
        d=self.data();self.assertIsNone(waiting_reason(d,2000))
        d['live']=True;self.assertIsNotNone(waiting_reason(d,2000))
        d['live']=False;d['segments'][0]['state']='queued';self.assertIsNotNone(waiting_reason(d,2000))
        d['segments'][0]['state']='done';self.assertIsNotNone(waiting_reason(d,1050))
    def test_compact_minutes_preserve_all_observed_values(self):
        p=build_payload(self.data());row=p['minuteEvidence'][0]
        labels=p['minuteMetricOrder'];cols=p['minuteColumns']
        likes=dict(zip(cols,row['values'][labels.index('点赞次数')]))
        self.assertEqual(likes,{'count':3,'first':100,'last':2,'min':2,'max':120,'sampleMean':None})
        self.assertIsNone(row['values'][labels.index('分享次数')])
    def test_http_errors_keep_status_without_response_secrets(self):
        from urllib.error import HTTPError
        from backend.session_analysis import error_label
        self.assertEqual(error_label(HTTPError('https://private',502,'secret',{},None)),'HTTPError:502')
    def test_streaming_response_and_truncation(self):
        from backend.session_analysis import stream_content
        line=lambda choice:('data: '+json.dumps({'choices':[choice]})+'\n').encode()
        chunks=[b': keepalive\n',line({'delta':{'content':'内容'},'finish_reason':None}),line({'delta':{},'finish_reason':'stop'}),b'data: [DONE]\n']
        self.assertEqual(stream_content(chunks),'内容')
        with self.assertRaises(ValueError):stream_content(chunks[:2])
        with self.assertRaises(ValueError):stream_content([line({'delta':{'content':'截断'},'finish_reason':'length'})])
    def test_business_terms_do_not_change_source_quotes(self):
        from backend.session_analysis import business_output
        original={'overview':'概览','advice':'建议','limitations':'指标为分钟采样，humanNotes为空',
                  'events':[{'quote':'原文humanNotes','hypothesis':'eventCandidates'}]}
        out=business_output(original)
        self.assertIn('每10秒',out['limitations']);self.assertNotIn('humanNotes',out['limitations'])
        self.assertEqual(out['events'][0]['quote'],original['events'][0]['quote'])
    def test_projection_never_writes_human_review(self):
        d=self.data();row=analysis_row(d,{'status':'done','payload':build_payload(d),'output':{'overview':'概览','events':[],'advice':'建议','limitations':'局限'},'generatedAt':2000},'https://review.test')
        self.assertNotIn('运营复核',row);self.assertEqual(row['同步键'],d['id'])
        self.assertIn('回落',row['指标表现']);self.assertIn('缺失',row['数据说明'])

if __name__=='__main__':unittest.main()
