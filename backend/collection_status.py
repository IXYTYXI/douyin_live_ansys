"""Read-only diagnostics from durable records; never infer local collector health."""
from collections import Counter
from .audio_quality import audio_report,quality_notice


def processing_status(data, summaries):
    return {'audioQuality':audio_report(data.get('segments',[]),0,data.get('duration')), 'asr':dict(Counter(r['state'] for r in data.get('segments',[]))),
            'summaries':dict(Counter(r['status'] for r in summaries)),
            'recordings':len(data.get('recordings',[]))}


def collection_status(store):
    with store.connect() as db:
        rows=db.execute("""SELECT run_id,payload::jsonb->>'teacher',count(*),
          max(captured_at),max(received_at)
          FROM diting_metrics.samples GROUP BY run_id,payload::jsonb->>'teacher'
          ORDER BY max(received_at) DESC LIMIT 20""").fetchall()
        ends=dict(db.execute('SELECT run_id,verified FROM diting_metrics.run_ends WHERE run_id=ANY(%s)',([r[0] for r in rows],)).fetchall())
    return {'runs':[{'runId':r,'teacher':teacher,'count':count,
                    'finishState':('verified' if ends[r] else 'unverified') if r in ends else 'not-confirmed','lastCapturedAt':captured.isoformat(),'lastReceivedAt':received.isoformat()}
                   for r,teacher,count,captured,received in rows]}


def finishing_status(data, summaries):
    if data.get('live'):return ['仍在接收直播片段，尚未进入停播收尾。']
    duration=data.get('duration',0)
    result=['已登记录像 '+str(len(data.get('recordings',[])))+' 段；这里只能核对已入库片段，不能确认未到达的录像。']
    segments=data.get('segments',[])
    failed=sum(s['state']=='failed' for s in segments)
    pending=sum(s['state'] not in ('done','failed') for s in segments)
    notice=quality_notice(audio_report(segments,0,duration))
    if notice:result.append(notice.strip())
    result.append('转写失败 '+str(failed)+' 段，待处理 '+str(pending)+' 段。' if failed or pending else '已登记片段的 ASR 处理完成，不代表音轨有声音或语音完整。' if segments else '尚无转写片段。')
    if data.get('analysisReadyAt',0)<duration:result.append('人数数据尚未覆盖录像末尾，末段总结可能仍在等待。')
    from .live import analysis_windows
    expected={(round(a*1000),round(b*1000)) for a,b in analysis_windows(duration,False)}
    done={(round(s['start']*1000),round(s['end']*1000)) for s in summaries if s['status']=='done'}
    remaining=len(expected-done)
    result.append('总结仍有 '+str(remaining)+' 个区间未完成。' if remaining else '当前录像范围的总结已完成。' if duration else '尚无可总结的录像范围。')
    result.append('关联采集批次的结束事件已核验。' if data.get('collectorConfirmed') else '尾批人数是否全部上传：需在插件确认待上传为0；服务器尚未收到完整结束核验。')
    return result
