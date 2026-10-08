"""Readiness of received material, without claiming unseen source data is complete."""
METRICS_GRACE_SECONDS=300


def analysis_ready_at(data,now):
    duration=data['duration']
    covered=max((r['t']+15 for r in data['samples'] if r.get('value') is not None),default=0)
    if not data.get('live') and now>=data['startedAtUnix']+duration+METRICS_GRACE_SECONDS:
        return duration
    return min(duration,covered)


def gaps(intervals,start,end,tolerance=.5):
    result=[];cursor=start
    for a,b in sorted(intervals):
        a=max(start,a);b=min(end,b)
        if b<=a:continue
        if a>cursor+tolerance:result.append([cursor,a])
        cursor=max(cursor,b)
    if cursor<end-tolerance:result.append([cursor,end])
    return result


def metric_gaps(samples,start,end):
    # A sample is evidence for its ten-second interval, not for an unlimited gap.
    return gaps([(s['t'],s['t']+10) for s in samples if s.get('value') is not None],start,end,5)


def review_readiness(data,summaries):
    duration=data.get('duration',0);reasons=[]
    if data.get('live'):return {'state':'live','label':'直播中／等待停播确认','reasons':[]}
    if duration<=0 or not data.get('recordings'):return {'state':'processing','label':'等待录像','reasons':['尚无已入库录像，不能确认复盘就绪。']}
    segments=data.get('segments',[])
    if any(s['state']=='failed' for s in segments) or any(s['status']=='failed' for s in summaries):
        return {'state':'attention','label':'处理失败，需检查','reasons':['存在转写或总结失败；已完成内容仍可查看。']}
    if not segments or any(s['state']!='done' for s in segments):
        return {'state':'processing','label':'转写处理中','reasons':['等待已登记片段转写完成。']}
    from .live import analysis_windows
    expected={(round(a*1000),round(b*1000)) for a,b in analysis_windows(duration,False)}
    done={(round(s['start']*1000),round(s['end']*1000)) for s in summaries if s['status']=='done'}
    if expected-done:
        waiting=data.get('analysisReadyAt',0)<duration
        return {'state':'processing','label':'等待人数补传' if waiting else '总结处理中','reasons':['停播后为人数补传预留5分钟，超时后按已有文字总结并注明缺失。' if waiting else '仍有总结区间未完成；模型未配置时需先配置模型。']}
    if metric_gaps(data['samples'],0,duration):reasons.append('人数存在缺失，无法提供完整人数分析。')
    if gaps([(r['start'],r['start']+r['duration']) for r in data['recordings']],0,duration):reasons.append('已收到的录像之间存在间隙。')
    if gaps([(s['start'],s['end']) for s in segments],0,duration):reasons.append('转写时间范围存在缺口。')
    if not data.get('collectorConfirmed'):reasons.append('关联采集批次尚未全部确认结束，或旧批次缺少总数核验。')
    return {'state':'ready_with_gaps' if reasons else 'ready','label':'可复盘，但有缺失或待核验项' if reasons else '已入库内容核验完成','reasons':reasons}
