import array
import sys
import tempfile
import unittest
import wave
from pathlib import Path
from backend import audio_quality as aq


def pcm(values):
    a=array.array('h',values)
    if sys.byteorder!='little':a.byteswap()
    return a.tobytes()


def segment(start,seconds,quiet=True):
    evidence=aq.pcm_quality(pcm(([0] if quiet else [1000])*int(seconds*16000)))
    return {'start':start,'end':start+seconds,'state':'done','text':'','audio_quality':evidence}


class AudioQualityTests(unittest.TestCase):
    def test_silence_quiet_sound_and_partial_second(self):
        zero=aq.pcm_quality(pcm([0]*20000))
        self.assertEqual(zero['lowVolumeRanges'],[[0,1.25]])
        self.assertIsNone(zero['lastAudibleAt'])
        quiet=aq.pcm_quality(pcm([10]*16000))
        self.assertEqual(quiet['lowVolumeRanges'],[[0,1]])
        sound=aq.pcm_quality(pcm([1000]*16000+[0]*8000))
        self.assertEqual(sound['lowVolumeRanges'],[[1,1.5]])
        self.assertEqual(sound['audibleSeconds'],1)
        self.assertEqual(sound['lastAudibleAt'],1)
    def test_contiguous_silence_alerts_without_asr_dependency(self):
        rows=[segment(0,45),segment(45,15)]
        rows[1]['state']='queued'
        result=aq.audio_report(rows,0,60)
        self.assertEqual(result['sustainedLowVolumeRanges'],[[0,60]])
        self.assertEqual(result['state'],'silent')
    def test_gaps_unknown_and_short_pauses_do_not_join_into_long_silence(self):
        for middle in ([],[{'start':30,'end':40,'state':'done'}]):
            report=aq.audio_report([segment(0,30),*middle,segment(40,30)],0,70)
            self.assertEqual(report['sustainedLowVolumeRanges'],[])
        self.assertEqual(aq.audio_report([{'start':0,'end':60}],0,60)['uncheckedRanges'],[[0,60]])
    def test_restored_sound_keeps_prior_incident_and_clips_window(self):
        rows=[segment(0,60),segment(60,10,False)]
        r=aq.audio_report(rows,0,70)
        self.assertEqual(r['state'],'recovered')
        self.assertEqual(r['sustainedLowVolumeRanges'],[[0,60]])
        self.assertEqual(r['lastAudibleAt'],70)
        self.assertEqual(aq.audio_report(rows,30,70)['lowVolumeRanges'],[[30,60]])
    def test_unchecked_tail_never_claims_recovery(self):
        r=aq.audio_report([segment(0,60),{'start':60,'end':90}],0,90)
        self.assertEqual(r['state'],'unknown')
    def test_wav_contract_rejects_wrong_rate_and_stereo(self):
        with tempfile.TemporaryDirectory() as root:
            path=Path(root)/'a.wav'
            with wave.open(str(path),'wb') as w:
                w.setparams((2,2,16000,0,'NONE','not compressed'));w.writeframes(pcm([0]*32000))
            with self.assertRaises(ValueError):aq.wav_quality(path)
    def test_notice_explicit_and_does_not_duplicate(self):
        r=aq.audio_report([segment(0,60)],0,60)
        fields={'conclusion':'原结论','periodTheme':'主题','keywords':[],'adjustment':''}
        revised=aq.annotate_fields(fields,r)
        self.assertIn('静音或音量极低',revised['conclusion'])
        self.assertEqual(aq.annotate_fields(revised,r),revised)
        self.assertEqual(fields['conclusion'],'原结论')
        prefixed={**revised,'conclusion':'【数据说明】人数缺失\n'+revised['conclusion']}
        self.assertEqual(aq.annotate_fields(prefixed,r)['conclusion'].count('【音频说明】'),1)
