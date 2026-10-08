"""Read-only diagnostics from durable records; never infer local collector health."""
from collections import Counter


def processing_status(data, summaries):
    return {'asr':dict(Counter(r['state'] for r in data.get('segments',[]))),
            'summaries':dict(Counter(r['status'] for r in summaries)),
            'recordings':len(data.get('recordings',[]))}


def collection_status(store):
    with store.connect() as db:
        rows=db.execute("""SELECT run_id,payload::jsonb->>'teacher',count(*),
          max(captured_at),max(received_at)
          FROM diting_metrics.samples GROUP BY run_id,payload::jsonb->>'teacher'
          ORDER BY max(received_at) DESC LIMIT 20""").fetchall()
    return {'runs':[{'runId':r,'teacher':teacher,'count':count,
                    'lastCapturedAt':captured.isoformat(),'lastReceivedAt':received.isoformat()}
                   for r,teacher,count,captured,received in rows]}
