import hashlib
import importlib.util
import json
import shutil
import struct
import subprocess
import tempfile
import unittest
from pathlib import Path


def boxes(path):
    result=[]
    with path.open('rb') as f:
        while True:
            offset=f.tell(); header=f.read(8)
            if len(header)<8:break
            size,kind=struct.unpack('>I4s',header)
            if size==1:size=struct.unpack('>Q',f.read(8))[0]
            if size<8:break
            result.append(kind.decode()); f.seek(offset+size)
    return result

class PlaybackMediaTest(unittest.TestCase):
    def playback(self):
        self.assertIsNotNone(importlib.util.find_spec('backend.playback'), 'playback preparation is missing')
        from backend import playback
        return playback

    @unittest.skipUnless(shutil.which('ffmpeg') and shutil.which('ffprobe'), 'FFmpeg required')
    def test_finalized_fragmented_video_gets_faststart_without_changing_original(self):
        playback=self.playback()
        with tempfile.TemporaryDirectory() as d:
            root=Path(d); (root/'media').mkdir(); name='a'*64+'.mp4'; source=root/'media'/name
            subprocess.run(['ffmpeg','-v','error','-f','lavfi','-i','color=size=160x90:rate=10:duration=3','-f','lavfi','-i','sine=duration=3','-c:v','libx264','-c:a','aac','-movflags','frag_keyframe+empty_moov','-shortest',str(source)],check=True)
            original=source.read_bytes(); self.assertIn('moof',boxes(source))
            self.assertEqual(playback.playback_media(root,name),name)
            target=playback.prepare_playback(root,name)
            self.assertNotEqual(target.name,name)
            self.assertEqual(source.read_bytes(),original)
            self.assertNotIn('moof',boxes(target)); self.assertLess(boxes(target).index('moov'),boxes(target).index('mdat'))
            def probe(p):return json.loads(subprocess.check_output(['ffprobe','-v','error','-show_entries','stream=codec_name,duration,nb_frames','-of','json',str(p)]))['streams']
            before,after=probe(source),probe(target)
            self.assertEqual([s['codec_name'] for s in before],[s['codec_name'] for s in after])
            self.assertAlmostEqual(float(before[0]['duration']),float(after[0]['duration']),delta=.15)
            self.assertEqual(playback.playback_media(root,name),target.name)
            stamp=target.stat().st_mtime_ns
            self.assertEqual(playback.prepare_playback(root,name),target)
            self.assertEqual(target.stat().st_mtime_ns,stamp)

    def test_invalid_media_is_not_published(self):
        playback=self.playback()
        with tempfile.TemporaryDirectory() as d:
            root=Path(d); (root/'media').mkdir(); name='b'*64+'.mp4'; (root/'media'/name).write_bytes(b'invalid')
            with self.assertRaises((ValueError,subprocess.CalledProcessError)):
                playback.prepare_playback(root,name)
            self.assertEqual(playback.playback_media(root,name),name)
            self.assertEqual(len(list((root/'media').iterdir())),1)
            with self.assertRaises(ValueError):playback.prepare_playback(root,'../not-allowed.mp4')
