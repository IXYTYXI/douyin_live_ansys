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
            pipeline=Mock();store=Mock();store.register.return_value=1791420000.123456
            scan(pipeline,store,inbox);pipeline.ingest.assert_not_called()
            ready=source.with_suffix('.ready');ready.write_text(json.dumps({'path':str(source)}))
            pipeline.ingest.side_effect=RuntimeError('temporary failure')
            scan(pipeline,store,inbox);self.assertTrue(source.exists());self.assertTrue(ready.exists())
            pipeline.ingest.side_effect=None
            scan(pipeline,store,inbox);self.assertFalse(source.exists());self.assertTrue(source.with_suffix('.done').exists())
            self.assertEqual(pipeline.ingest.call_count,2)
            scan(pipeline,store,inbox);self.assertEqual(pipeline.ingest.call_count,2)
