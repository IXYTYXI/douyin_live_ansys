"""Encrypted-stream authorization, finalized recording inbox, and bounded ASR worker."""
import json,os,threading,time
from pathlib import Path
from datetime import datetime,timezone
from urllib.parse import urlsplit
from .asr import CompanyASR
from .live import LiveStore,valid_publish,segment_stamp,continuation_offset,RECONNECT_SECONDS
from .pipeline import Pipeline
from .server import MediaSigner,make_server


def iso(stamp):return datetime.fromtimestamp(stamp,timezone.utc).isoformat()


def scan(pipeline,store,inbox):
    inbox=inbox.resolve()
    # Finish cleanup after a crash between committed import and input removal.
    for done in inbox.glob('*/*.done'):
        source=done.with_suffix('.mp4')
        if source.is_file():source.unlink()
    for ready in sorted(inbox.glob('*/*.ready')):
        try:
            event=json.loads(ready.read_text())
            source=Path(event['path']).resolve(strict=True)
            if source.parent!=ready.parent or source.stem!=ready.stem:raise ValueError('invalid inbox event')
            if any(p.name<source.name for p in source.parent.glob('*.mp4')):continue
            run=ready.parent.name;stamp=segment_stamp(source.name)
            # Earlier files exist even if their completion hook is delayed. Done markers preserve the origin.
            stamps=[segment_stamp(p.with_suffix('.mp4').name) for p in source.parent.iterdir() if p.suffix in ('.mp4','.ready','.done')]
            channel=run.startswith('channel-')
            if channel:
                assigned=store.register_segment(run,source.name,stamp)
                sid=assigned['id'];start=assigned['started']
            else:
                start=store.register(run,min(stamps));sid='live-'+run
            if 'recordedAt' not in event:
                try:previous=pipeline.review(sid)['recordings']
                except KeyError:previous=[]
                previous_end=max((r['start']+r['duration'] for r in previous),default=0)
                offset=continuation_offset(stamp-start,previous_end) if previous else stamp-start
                event['recordedAt']=iso(start+offset)
                temporary=ready.with_suffix('.pending');temporary.write_text(json.dumps(event));temporary.replace(ready)
            pipeline.ingest(sid,iso(start),event['recordedAt'],source,45)
            if channel:
                recordings=pipeline.review(sid)['recordings']
                end=start+max(r['start']+r['duration'] for r in recordings)
                store.finish_segment(run,source.name,end)
            ready.rename(ready.with_suffix('.done'))
            # Pipeline has an immutable hashed copy before the temporary input is removed.
            source.unlink()
        except Exception as e:
            print('Live segment pending:',type(e).__name__,flush=True)
    for state in inbox.glob('*/state.json'):
        try:
            live=json.loads(state.read_text())['live'] is True
            # Do not close analysis until all finalized input segments are imported.
            if not live and (list(state.parent.glob('*.ready')) or list(state.parent.glob('*.mp4')) or time.time()-json.loads(state.read_text())['at']<(RECONNECT_SECONDS if state.parent.name.startswith('channel-') else 15)):continue
            with store.connect() as db:
                if state.parent.name.startswith('channel-'):
                    # Ready must not resurrect all historical sessions for a fixed channel.
                    if not live:db.execute('UPDATE diting_live.sessions SET live=false WHERE channel_id=%s',(state.parent.name,))
                else:db.execute('UPDATE diting_live.sessions SET live=%s WHERE run_id=%s',(live,state.parent.name))
        except Exception as e:print('Live status pending:',type(e).__name__,flush=True)


def main():
    from .audio_quality import backfill
    pipeline=Pipeline.__new__(Pipeline)
    pipeline.root=Path(os.environ['DATA_DIR']).resolve();pipeline.business='douyin_live'
    pipeline.schema='diting_asr_douyin_live';pipeline.max_inflight=1;pipeline.poll_seconds=5
    pipeline.database_url=os.environ['ASR_DATABASE_URL']
    store=LiveStore(os.environ['ASR_DATABASE_URL']);inbox=Path(os.environ['LIVE_INBOX'])
    provider=CompanyASR(os.environ['COMPANY_ASR_URL'],os.environ.get('COMPANY_ASR_HOST',''),
                        'diting-douyin-live',os.environ.get('COMPANY_ASR_BEARER',''),requests_per_minute=30)
    signer=MediaSigner(os.environ['MEDIA_SIGNING_KEY'],os.environ['PUBLIC_BASE_URL']+'/asr-audio')
    server=make_server(pipeline,signer,os.environ['REVIEW_API_KEY'],port=18778)
    base=server.RequestHandlerClass
    class Handler(base):
        def do_POST(self):
            if self.path!='/auth':return self.reply(404,{'error':'not found'})
            try:
                n=int(self.headers.get('Content-Length','0'))
                if not 0<n<=8192:raise ValueError()
                self.connection.settimeout(5)
                payload=json.loads(self.rfile.read(n))
                if not valid_publish(os.environ['STREAM_SIGNING_KEY'],payload):raise ValueError()
                store.channel_teacher(payload['path']) if payload['path'].startswith('channel-') else store.teacher(payload['path'])
                return self.reply(200,{'ok':True})
            except Exception:return self.reply(401,{'error':'publish not authorized'})
        def do_GET(self):
            path=urlsplit(self.path).path
            if not path.startswith('/media/') or not path.endswith('.wav'):return self.reply(404,{'error':'not found'})
            return super().do_GET()
    server.RequestHandlerClass=Handler
    def importer():
        while True:
            try:
                scan(pipeline,store,inbox)
                backfill(pipeline,limit=20)
            except Exception as e:print('Live scan failed:',type(e).__name__,flush=True)
            time.sleep(3)
    def transcriber():
        while True:
            try:worked=pipeline.step(provider,lambda name:signer.url(name,ttl=172800))
            except Exception as e:print('Live ASR pending:',type(e).__name__,flush=True);worked=False
            time.sleep(.2 if worked else 1)
    threading.Thread(target=importer,daemon=True).start()
    threading.Thread(target=transcriber,daemon=True).start()
    server.serve_forever()


if __name__=='__main__':main()
