import unittest
from backend.live import stream_password, valid_publish, segment_stamp, analysis_windows

class LiveTests(unittest.TestCase):
    def test_publish_scope(self):
        run='9cc2845a-2307-43da-a4c3-48da19097548';secret='s'*32
        p={'path':run,'action':'publish','protocol':'rtmp','user':'diting','password':stream_password(secret,run)}
        self.assertTrue(valid_publish(secret,p))
        for field,value in [('action','read'),('path','../escape'),('password','bad'),('protocol','rtsp')]:
            self.assertFalse(valid_publish(secret,{**p,field:value}))
        self.assertFalse(valid_publish('different',p))
    def test_segment_timestamp(self):
        self.assertEqual(segment_stamp('1791420000-123456.mp4'),1791420000.123456)
        for name in ['../1-2.mp4','1.mp4','x-000000.mp4']:
            with self.assertRaises(ValueError):segment_stamp(name)
    def test_only_closed_windows_during_live(self):
        self.assertEqual(analysis_windows(599,True),[])
        self.assertEqual(analysis_windows(650,True),[(0,600)])
        self.assertIn((0,1800),analysis_windows(1850,True))
        self.assertIn((600,650),analysis_windows(650,False))

    def test_only_finalized_segments_are_imported_and_retry_preserves_input(self):
        import json,tempfile
        from pathlib import Path
        from unittest.mock import Mock
        from backend.live_service import scan
        with tempfile.TemporaryDirectory() as root:
            inbox=Path(root);folder=inbox/'9cc2845a-2307-43da-a4c3-48da19097548';folder.mkdir()
            source=folder/'1791420000-123456.mp4';source.write_bytes(b'completed video')
            pipeline=Mock();pipeline.review.return_value={'recordings':[]};store=Mock();store.register.return_value=1791420000.123456
            scan(pipeline,store,inbox);pipeline.ingest.assert_not_called()
            ready=source.with_suffix('.ready');ready.write_text(json.dumps({'path':str(source)}))
            pipeline.ingest.side_effect=RuntimeError('temporary failure')
            scan(pipeline,store,inbox);self.assertTrue(source.exists());self.assertTrue(ready.exists())
            pipeline.ingest.side_effect=None
            scan(pipeline,store,inbox);self.assertFalse(source.exists());self.assertTrue(source.with_suffix('.done').exists())
            self.assertEqual(pipeline.ingest.call_count,2)
            scan(pipeline,store,inbox);self.assertEqual(pipeline.ingest.call_count,2)

    def test_continuation_uses_media_duration_without_hiding_real_gap(self):
        from backend.live import continuation_offset
        self.assertEqual(continuation_offset(59.97,61.84),61.84)
        self.assertEqual(continuation_offset(62.2,61.84),61.84)
        self.assertEqual(continuation_offset(70,61.84),70)

class ChannelTests(unittest.TestCase):
    def test_fixed_channel_key_is_authorized_without_a_collector_run(self):
        from backend.live import stream_path
        channel='channel-9cc2845a-2307-43da-a4c3-48da19097548'
        self.assertTrue(stream_path(channel))
        p={'path':channel,'action':'publish','protocol':'rtmp','user':'diting','password':stream_password('secret',channel)}
        self.assertTrue(valid_publish('secret',p))
        self.assertFalse(valid_publish('secret',{**p,'path':channel+'x'}))

    def test_reconnect_boundary_uses_media_time_not_import_time(self):
        from backend.live import resume_session
        self.assertTrue(resume_session(100,250))
        self.assertTrue(resume_session(100,280))
        self.assertFalse(resume_session(100,280.01))
        self.assertFalse(resume_session(None,10))

    def test_channel_stop_waits_three_minutes_and_all_finalized_inputs(self):
        import json,tempfile
        from pathlib import Path
        from unittest.mock import MagicMock,patch
        from backend.live_service import scan
        with tempfile.TemporaryDirectory() as root:
            folder=Path(root)/'channel-9cc2845a-2307-43da-a4c3-48da19097548';folder.mkdir()
            (folder/'state.json').write_text(json.dumps({'live':False,'at':1000}))
            store=MagicMock();pipeline=MagicMock()
            with patch('backend.live_service.time.time',return_value=1179.99):scan(pipeline,store,Path(root))
            store.connect.assert_not_called()
            source=folder/'1791420000-123456.mp4';source.write_bytes(b'unfinalized')
            with patch('backend.live_service.time.time',return_value=1180):scan(pipeline,store,Path(root))
            store.connect.assert_not_called()
            source.unlink()
            with patch('backend.live_service.time.time',return_value=1180):scan(pipeline,store,Path(root))
            store.connect.return_value.__enter__.return_value.execute.assert_called_once()

    def test_channel_segment_retry_reuses_session_and_finishes_before_removal(self):
        import json,tempfile
        from pathlib import Path
        from unittest.mock import Mock
        from backend.live_service import scan
        with tempfile.TemporaryDirectory() as root:
            folder=Path(root)/'channel-9cc2845a-2307-43da-a4c3-48da19097548';folder.mkdir()
            source=folder/'1791420000-123456.mp4';source.write_bytes(b'video')
            source.with_suffix('.ready').write_text(json.dumps({'path':str(source)}))
            pipeline=Mock();pipeline.review.return_value={'recordings':[{'start':0,'duration':60}]}
            store=Mock();store.register_segment.return_value={'id':'live-auto-id','started':1791420000.123456}
            store.finish_segment.side_effect=RuntimeError('retry transaction')
            scan(pipeline,store,Path(root))
            self.assertTrue(source.exists())
            store.finish_segment.side_effect=None
            scan(pipeline,store,Path(root))
            self.assertFalse(source.exists())
            self.assertEqual(pipeline.ingest.call_args.args[0],'live-auto-id')
            self.assertEqual(pipeline.ingest.call_args_list[0],pipeline.ingest.call_args_list[1])
