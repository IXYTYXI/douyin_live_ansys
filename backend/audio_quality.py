"""Evidence about received PCM amplitude, separate from ASR success or speech detection."""
import array
import json
import math
import sys
import wave
from pathlib import Path

VERSION=1
RATE=16000
LOW_PEAK=32768*10**(-60/20)
ALERT_SECONDS=60


def merge_ranges(ranges):
    result=[]
    for a,b in sorted(ranges):
        if b<=a:continue
        if result and a<=result[-1][1]+1e-6:result[-1][1]=max(result[-1][1],b)
        else:result.append([a,b])
    return result


def pcm_quality(pcm):
    if not pcm or len(pcm)%2:raise ValueError('invalid PCM16')
    values=array.array('h',pcm)
    if sys.byteorder!='little':values.byteswap()
    low=[];peak=0;audible=0;last=None
    for i in range(0,len(values),RATE):
        block=values[i:i+RATE];p=max(abs(v) for v in block);peak=max(peak,p)
        a,b=i/RATE,(i+len(block))/RATE
        if p<=LOW_PEAK:low.append([a,b])
        else:audible+=b-a;last=b
    return {'version':VERSION,'thresholdDbfs':-60,'duration':len(values)/RATE,
            'peakDbfs':round(20*math.log10(peak/32768),2) if peak else None,
            'lowVolumeRanges':merge_ranges(low),'audibleSeconds':audible,'lastAudibleAt':last}


def wav_quality(path):
    with wave.open(str(path),'rb') as audio:
        if (audio.getnchannels(),audio.getsampwidth(),audio.getframerate(),audio.getcomptype())!=(1,2,RATE,'NONE'):
            raise ValueError('expected mono 16k PCM16')
        if not 0<audio.getnframes()<=RATE*60:raise ValueError('unexpected audio chunk length')
        return pcm_quality(audio.readframes(audio.getnframes()))


def checked_quality(segment):
    q=segment.get('audio_quality')
    return q if q and q.get('version')==VERSION and not q.get('error') and abs(q.get('duration',-1)-(segment['end']-segment['start']))<.002 else None


def audio_report(segments,start=0,end=None):
    end=max((s['end'] for s in segments),default=start) if end is None else end
    checked=[];unknown=[];low=[];audible=[];last=None
    for s in segments:
        a,b=max(start,s['start']),min(end,s['end'])
        if b<=a:continue
        q=checked_quality(s)
        if q is None:unknown.append([a,b]);continue
        checked.append([a,b]);cursor=a
        for x,y in q['lowVolumeRanges']:
            x,y=max(a,s['start']+x),min(b,s['start']+y)
            if y<=x:continue
            low.append([x,y])
            if x>cursor:audible.append([cursor,x]);last=max(last or 0,x)
            cursor=max(cursor,y)
        if cursor<b:audible.append([cursor,b]);last=max(last or 0,b)
    low=merge_ranges(low);checked=merge_ranges(checked);unknown=merge_ranges(unknown)
    sustained=[r for r in low if r[1]-r[0]>=ALERT_SECONDS-1e-6]
    until=max((b for _,b in checked),default=None)
    tail_unknown=until is None or until<end-1e-6 or any(b>=end-1e-6 for _,b in unknown)
    state='unknown' if tail_unknown else 'silent' if sustained and low[-1][1]>=end-1e-6 else 'recovered' if sustained and last is not None and last>sustained[-1][1] else 'history' if sustained else 'sound'
    return {'state':state,'thresholdDbfs':-60,'alertSeconds':ALERT_SECONDS,'checkedUntil':until,
            'checkedSeconds':sum(b-a for a,b in checked),'audibleSeconds':sum(b-a for a,b in merge_ranges(audible)),
            'lastAudibleAt':last,'lowVolumeRanges':low,'sustainedLowVolumeRanges':sustained,'uncheckedRanges':unknown}


def quality_notice(report):
    notes=[]
    ranges=report.get('sustainedLowVolumeRanges',[])
    if ranges:
        stamp=lambda t:f'{int(t)//60:02d}:{int(t)%60:02d}'
        intervals='、'.join(f'{stamp(a)}—{stamp(b)}' for a,b in ranges[:4])
        if len(ranges)>4:intervals+=f'等{len(ranges)}段'
        notes.append(f'相对开播 {intervals} 检测到持续静音或音量极低；无法据此还原讲话内容或判断原因。')
    if report.get('uncheckedRanges'):notes.append('部分音轨尚未完成音量检测，不能确认录音正常。')
    return ('【音频说明】'+''.join(notes)+'有声音也不等于有可识别语音。\n') if notes else ''


def annotate_fields(fields,report):
    notice=quality_notice(report)
    if not notice:return dict(fields)
    body=fields.get('conclusion','')
    body='\n'.join(line for line in body.split('\n') if not line.startswith('【音频说明】'))
    return {**fields,'conclusion':notice+body[:8000-len(notice)]}


def backfill(pipeline,limit=20,session_id=None):
    """Bounded background migration of existing chunks; never read audio in HTTP handlers."""
    with pipeline.db() as db:
        rows=db.execute('SELECT id,audio FROM segments WHERE audio_quality IS NULL AND (%s::text IS NULL OR session_id=%s) ORDER BY start DESC LIMIT %s',(session_id,session_id,limit)).fetchall()
    updated=0
    for row in rows:
        path=pipeline.root/'media'/row['audio']
        try:
            if path.is_symlink() or path.parent.resolve()!=(pipeline.root/'media').resolve():raise ValueError('invalid audio file')
            q=wav_quality(path)
        except (OSError,ValueError,wave.Error,EOFError) as error:
            q={'version':VERSION,'error':type(error).__name__}
        with pipeline.db() as db:
            updated+=db.execute('UPDATE segments SET audio_quality=%s::jsonb WHERE id=%s AND audio_quality IS NULL',(json.dumps(q),row['id'])).rowcount
    return updated
