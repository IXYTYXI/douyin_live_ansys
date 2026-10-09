import unittest
from backend.lark_sync import project, sync_rows, DuplicateKey, index_records

class Fake:
    def __init__(self):self.rows={};self.writes=0;self.ambiguous=False
    def index(self,table):return dict(self.rows)
    def create(self,table,rows):
        for row in rows:
            self.rows[row['同步键']]=f'rec{len(self.rows)}';self.writes+=1
        if self.ambiguous:self.ambiguous=False;raise TimeoutError()
    def update(self,table,rid,row):self.writes+=1

class SyncTests(unittest.TestCase):
    def data(self):
        return {'id':'live-a','teacher':'主播','startedAtUnix':1000,'duration':600,'live':True,'samples':[{'t':1,'value':0}], 'segments':[], 'summaries':[{'start':0,'end':600,'status':'done','fields':{'periodTheme':'主题','keywords':['词'],'conclusion':'AI'}}], 'notes':[{'scope':'range','start':0,'end':600,'fields':{'conclusion':'人工时段'}}], 'collectionStatus':{'readiness':{'state':'live','label':'直播中','reasons':[]}}}
    def test_sample_metrics_keep_zero_missing_and_approximation(self):
        from backend.lark_sync import sample_fields
        fields=sample_fields({'value':12,'metrics':{'likes':{'value':1200,'approximate':True},'shares':{'value':0},'newFollowers':{'value':True}}})
        self.assertEqual(fields['在线人数'],12)
        self.assertEqual(fields['点赞次数'],1200)
        self.assertEqual(fields['分享次数'],0)
        self.assertIsNone(fields['新增粉丝'])
        self.assertIsNone(fields['送礼人数'])
        self.assertEqual(fields['近似值指标'],'点赞次数')
    def test_metric_backfill_updates_existing_key_once(self):
        from backend.lark_sync import sample_fields
        c=Fake();state={};row={'同步键':'a','在线人数':12}
        sync_rows(c,'samples',[row],state,'old')
        changed={'同步键':'a',**sample_fields({'value':12,'metrics':{'likes':{'value':200}}})}
        sync_rows(c,'samples',[changed],state,'now')
        self.assertEqual(len(c.rows),1);self.assertEqual(c.writes,2)
        sync_rows(c,'samples',[changed],state,'later');self.assertEqual(c.writes,2)
    def test_zero_is_real_value_not_missing(self):
        s,p=project(self.data(),'https://review.test');self.assertEqual(s['在线均值'],0);self.assertEqual(p[0]['在线峰值'],0)
    def test_missing_is_null(self):
        d=self.data();d['samples']=[];s,p=project(d,'https://review.test');self.assertIsNone(s['在线均值']);self.assertIsNone(p[0]['在线峰值']);self.assertIn('缺失',p[0]['数据说明'])
    def test_whole_session_does_not_use_range_note_or_live_ai(self):
        s,p=project(self.data(),'https://review.test');self.assertIsNone(s['运营整场结论']);self.assertIsNone(s['AI整场结论']);self.assertEqual(p[0]['运营结论'],'人工时段')
    def test_retry_after_unknown_create_result_does_not_duplicate(self):
        c=Fake();c.ambiguous=True;state={};rows=[{'同步键':'a','值':1}]
        with self.assertRaises(TimeoutError):sync_rows(c,'table',rows,state,'now')
        self.assertEqual(state,{})
        sync_rows(c,'table',rows,state,'now');self.assertEqual(len(c.rows),1)
        before=c.writes;sync_rows(c,'table',rows,state,'later');self.assertEqual(c.writes,before)
    def test_source_update_and_null_clear_are_written(self):
        c=Fake();state={};sync_rows(c,'t',[{'同步键':'a','值':2}],state,'now');before=c.writes
        sync_rows(c,'t',[{'同步键':'a','值':None}],state,'later');self.assertEqual(c.writes,before+1)
    def test_thirty_minute_human_note_is_not_dropped(self):
        d=self.data();d['duration']=1800;d['notes']=[{'scope':'range','start':0,'end':1800,'fields':{'conclusion':'半小时人工复盘'}}]
        _,rows=project(d,'https://review.test');self.assertEqual(sum(r['运营结论']=='半小时人工复盘' for r in rows),1)

    def test_duplicate_remote_key_rejected(self):
        with self.assertRaises(DuplicateKey):index_records({'fields':['同步键'],'data':[['a'],['a']],'record_id_list':['r1','r2']})
    def test_new_partial_window_keeps_stable_key(self):
        d=self.data();d['live']=False;d['duration']=650;d['summaries'].append({'start':600,'end':650,'status':'done','fields':{}})
        _,a=project(d,'https://review.test');d['duration']=660;d['summaries'][-1]['end']=660;_,b=project(d,'https://review.test');self.assertEqual(a[-1]['同步键'],b[-1]['同步键'])

if __name__=='__main__':unittest.main()
