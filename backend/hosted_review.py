"""Authenticated recording and live-session review, with separate human notes."""
import os,json,threading,time
from pathlib import Path
from datetime import datetime,timezone
from urllib.parse import urlsplit
from .pipeline import Pipeline
from .playback import playback_media
from .metrics import Conflict
from .metric_projection import review_samples
from .reviews import ReviewStore
from .live import LiveStore,stream_password
from .summary_worker import cycle
from .readiness import analysis_ready_at,review_readiness
from .collection_status import collection_status,processing_status,finishing_status
from .server import make_server,MediaSigner


def main():
    dsn=os.environ['REVIEW_DATABASE_URL'];default=os.environ['REVIEW_SESSION']
    store=LiveStore(dsn);reviews=ReviewStore(dsn)
    def pipeline_for(session):
        p=Pipeline.__new__(Pipeline);p.root=Path(os.environ['DATA_DIR']).resolve();p.database_url=dsn
        p.schema='diting_asr_douyin_live' if session.startswith('live-') else 'diting_asr_douyin_recording_test'
        return p
    def metadata(session):
        if session==default:return {'id':default,'runId':os.environ['REVIEW_METRICS_RUN'],'teacher':os.environ.get('REVIEW_TEACHER','录制主播'),'live':False}
        return next((r for r in store.sessions() if r['id']==session),None)
    def review_data(session):
        meta=metadata(session)
        if not meta:raise KeyError(session)
        data=pipeline_for(session).review(session)
        duration=max((r['start']+r['duration'] for r in data['recordings']),default=0)
        rows=store.sample_rows(meta,data['startedAtUnix'],duration)
        samples=review_samples(rows,duration)
        run_ids=list({r['runId'] for _,r in rows})
        with store.connect() as db:
            ends=dict(db.execute('SELECT run_id,verified FROM diting_metrics.run_ends WHERE run_id=ANY(%s)',(run_ids,)).fetchall())
        result={**data,**meta,'duration':duration,'samples':samples,'collectorConfirmed':bool(run_ids) and all(ends.get(r) is True for r in run_ids)}
        result['analysisReadyAt']=analysis_ready_at(result,time.time()) if session.startswith('live-') else duration
        return result

    signer=MediaSigner(os.environ['MEDIA_SIGNING_KEY'],os.environ['PUBLIC_BASE_URL'])
    server=make_server(pipeline_for(default),signer,os.environ['REVIEW_API_KEY'],port=18776)
    base=server.RequestHandlerClass;root=Path(__file__).parent.parent/'review-demo/dist'
    files={p.name for p in root.iterdir() if p.is_file()}
    class Hosted(base):
        def authenticated(self):return self.headers.get('X-Diting-Proxy')==os.environ['REVIEW_API_KEY']
        def do_POST(self):
            self.close_connection=True
            if not self.authenticated():return self.reply(401,{'error':'authentication required'})
            if self.headers.get('Origin')!=os.environ['PUBLIC_BASE_URL']:return self.reply(403,{'error':'same-origin request required'})
            if urlsplit(self.path).path not in ('/api/reviews','/api/live/channels'):return self.reply(404,{'error':'not found'})
            try:
                length=int(self.headers.get('Content-Length','0'))
                if self.headers.get('Transfer-Encoding') or not 0<length<=100000 or self.headers.get('Content-Type','').split(';')[0]!='application/json':raise ValueError()
                self.connection.settimeout(15);payload=json.loads(self.rfile.read(length))
                if urlsplit(self.path).path=='/api/live/channels':
                    channel=store.bind_channel(payload['teacher']);path=channel['id']
                    return self.reply(200,{**channel,'server':'rtmps://live-ansys.ai.lab.yc345.tv:1936','streamKey':path+'?user=diting&pass='+stream_password(os.environ['STREAM_SIGNING_KEY'],path)})
                session=payload.get('sessionId',default)
                result=reviews.save_notes(session,payload['records'],review_data(session)['duration'])
                return self.reply(200,{'notes':result})
            except Conflict as e:return self.reply(409,{'error':str(e)})
            except (ValueError,KeyError,TypeError):return self.reply(400,{'error':'invalid review'})
            except Exception:return self.reply(503,{'error':'保存失败，请稍后重试'})
        def do_GET(self):
            path=urlsplit(self.path).path
            if not self.authenticated():return self.reply(401,{'error':'authentication required'})
            try:
                if path=='/health':return self.reply(200,{'ok':True})
                if path=='/api/collection-status':return self.reply(200,collection_status(store))
                if path=='/api/live/channels':return self.reply(200,{'channels':store.channels()})
                if path=='/api/live/runs':return self.reply(200,{'runs':store.runs()})
                if path.startswith('/api/live/setup/'):
                    run=path.rsplit('/',1)[-1];teacher=store.teacher(run)
                    return self.reply(200,{'teacher':teacher,'server':'rtmps://live-ansys.ai.lab.yc345.tv:1936','streamKey':run+'?user=diting&pass='+stream_password(os.environ['STREAM_SIGNING_KEY'],run)})
                if path=='/api/sessions':
                    result=[]
                    for meta in [metadata(default),*store.sessions()]:
                        try:
                            data=pipeline_for(meta['id']).review(meta['id'])
                            result.append({'id':meta['id'],'teacher':meta['teacher'],'live':meta['live'],'startedAt':datetime.fromtimestamp(data['startedAtUnix'],timezone.utc).isoformat(),'duration':max((r['start']+r['duration'] for r in data['recordings']),default=0)})
                        except KeyError:continue
                    return self.reply(200,{'sessions':result,'defaultSession':default})
                if path=='/api/test/session' or path.startswith('/api/sessions/'):
                    session=default if path=='/api/test/session' else path.rsplit('/',1)[-1]
                    data=review_data(session)
                    return self.reply(200,{**data,'source':'live-review' if session.startswith('live-') else 'asr-integration-test','realRecording':True,
                        'startedAt':datetime.fromtimestamp(data['startedAtUnix'],timezone.utc).isoformat(),
                        'collectionStatus':{'readiness':review_readiness(data,reviews.summaries(session)),'finishing':finishing_status(data,reviews.summaries(session)),'count':len(data['samples']),'binding':'teacher-time' if data.get('channelId') else 'run-id','teacher':data['teacher'],**processing_status(data,reviews.summaries(session))},
                        'databaseReviews':True,'notes':reviews.read_notes(session),'summaries':reviews.summaries(session),
                        'summaryConfigured':all(os.environ.get(k) for k in ('SUMMARY_BASE_URL','SUMMARY_MODEL','SUMMARY_API_KEY')),
                        'recordings':[{**r,'url':signer.url(playback_media(pipeline_for(session).root,r['media']),ttl=3600)} for r in data['recordings']]})
            except (KeyError,ValueError):return self.reply(404,{'error':'session or run not found'})
            except Exception:return self.reply(503,{'error':'review temporarily unavailable'})
            if path.startswith('/media/'):return super().do_GET()
            if path=='/':path='/index.html'
            if path=='/live-setup':path='/live-setup.html'
            if path.lstrip('/') not in files:return self.reply(404,{'error':'not found'})
            target=root/path.lstrip('/');data=target.read_bytes()
            if target.suffix=='.html':data=data.replace(b'<head>',b'<head><meta name="diting-mode" content="real">')
            self.send_response(200)
            self.send_header('Content-Type',{'.mjs':'text/javascript','.js':'text/javascript','.css':'text/css','.html':'text/html'}.get(target.suffix,'application/octet-stream'))
            self.send_header('Content-Length',str(len(data)));self.send_header('Cache-Control','no-store');self.end_headers();self.wfile.write(data)
    server.RequestHandlerClass=Hosted
    def summaries():
        while True:
            try:
                for meta in [metadata(default),*store.sessions()]:
                    session=meta['id']
                    try:cycle(reviews,session,lambda sid=session:review_data(sid))
                    except Exception as e:print('Summary pending:',type(e).__name__,flush=True)
            except Exception as e:print('Summary list pending:',type(e).__name__,flush=True)
            time.sleep(30)
    threading.Thread(target=summaries,daemon=True).start();server.serve_forever()


if __name__=='__main__':main()
