"""Deploy an isolated RTMPS recorder and company ASR worker after git pull."""
import hashlib,json,os,secrets,subprocess,tarfile,tempfile,urllib.request
from pathlib import Path
import psycopg
from psycopg import sql
from psycopg.conninfo import make_conninfo,conninfo_to_dict

ROOT=Path(__file__).resolve().parents[2]
DOMAIN='live-ansys.ai.lab.yc345.tv'

def call(args):subprocess.run(args,check=True,stdout=subprocess.DEVNULL)
def config(path):return dict((k,json.loads(v)) for k,v in (l.split('=',1) for l in Path(path).read_text().splitlines() if '=' in l))
def save(path,text,mode=0o600):
    path=Path(path);tmp=path.with_suffix('.tmp');tmp.touch(mode=mode,exist_ok=True);tmp.chmod(mode);tmp.write_text(text);tmp.replace(path)
def envsave(path,values):save(path,'\n'.join(k+'='+json.dumps(v) for k,v in values.items())+'\n')
def docker_env(name):
    obj=json.loads(subprocess.check_output(['docker','inspect',name]))[0]
    return dict(v.split('=',1) for v in obj['Config']['Env'] if '=' in v)


def main():
    binary=Path('/usr/local/lib/diting/mediamtx-v1.21.1')
    if not binary.exists():
        url='https://github.com/bluenviron/mediamtx/releases/download/v1.21.1/mediamtx_v1.21.1_linux_amd64.tar.gz'
        with urllib.request.urlopen(url,timeout=45) as response:data=response.read(100_000_000)
        if hashlib.sha256(data).hexdigest()!='653abc672a3e693f8d3b2717752492fdcfb8072291ec108d03d3dd857411b0ee':raise RuntimeError('MediaMTX checksum mismatch')
        with tempfile.TemporaryDirectory() as folder:
            archive=Path(folder)/'mtx.tar.gz';archive.write_bytes(data)
            with tarfile.open(archive) as tar:
                item=tar.getmember('mediamtx')
                if not item.isfile():raise RuntimeError('invalid binary')
                binary.parent.mkdir(parents=True,exist_ok=True);binary.write_bytes(tar.extractfile(item).read());binary.chmod(0o755)
    review=config('/etc/diting-review.env');dbname=conninfo_to_dict(review['REVIEW_DATABASE_URL'])['dbname']
    if dbname!='diting_plugin_test_20261008':raise RuntimeError('unexpected database')
    previous=config('/etc/diting-live.env') if Path('/etc/diting-live.env').exists() else {}
    password=conninfo_to_dict(previous['ASR_DATABASE_URL'])['password'] if previous else secrets.token_urlsafe(32)
    secret=previous.get('STREAM_SIGNING_KEY') or secrets.token_urlsafe(32)
    pg=docker_env('postgres');admin=make_conninfo(host='127.0.0.1',port=5432,user=pg.get('POSTGRES_USER','postgres'),password=pg['POSTGRES_PASSWORD'],dbname=dbname)
    role='diting_live_worker'
    # Initialize new ASR schema only. Never change the old recording schema or other services.
    import sys
    sys.path.insert(0,str(ROOT))
    from backend.pipeline import Pipeline
    data=Path(review['DATA_DIR']);inbox=data/'live-inbox';inbox.mkdir(exist_ok=True)
    Pipeline(data,business='douyin_live',database_url=admin)
    with psycopg.connect(admin) as db:
        db.execute((ROOT/'backend/migrations/005_live.sql').read_text())
        if not db.execute('SELECT 1 FROM pg_roles WHERE rolname=%s',(role,)).fetchone():db.execute(sql.SQL('CREATE ROLE {} LOGIN').format(sql.Identifier(role)))
        db.execute(sql.SQL('ALTER ROLE {} PASSWORD {}').format(sql.Identifier(role),sql.Literal(password)))
        db.execute(sql.SQL('GRANT CONNECT ON DATABASE {} TO {}').format(sql.Identifier(dbname),sql.Identifier(role)))
        for schema in ('diting_live','diting_asr_douyin_live'):
            db.execute(sql.SQL('GRANT USAGE ON SCHEMA {} TO {},diting_review_reader').format(sql.Identifier(schema),sql.Identifier(role)))
            db.execute(sql.SQL('GRANT SELECT,INSERT,UPDATE ON ALL TABLES IN SCHEMA {} TO {}').format(sql.Identifier(schema),sql.Identifier(role)))
            db.execute(sql.SQL('GRANT SELECT ON ALL TABLES IN SCHEMA {} TO diting_review_reader').format(sql.Identifier(schema)))
        db.execute(sql.SQL('GRANT USAGE ON SCHEMA diting_metrics TO {}').format(sql.Identifier(role)))
        db.execute(sql.SQL('GRANT SELECT ON diting_metrics.samples TO {}').format(sql.Identifier(role)))
    provider=docker_env('tbjdasrailab-api-1')
    values={k:provider.get(k,'') for k in ('COMPANY_ASR_URL','COMPANY_ASR_HOST','COMPANY_ASR_BEARER')}
    if not values['COMPANY_ASR_URL']:raise RuntimeError('Company ASR configuration missing')
    values.update({'ASR_DATABASE_URL':make_conninfo(host='127.0.0.1',port=5432,user=role,password=password,dbname=dbname),'STREAM_SIGNING_KEY':secret,'LIVE_INBOX':str(inbox)})
    envsave('/etc/diting-live.env',values)
    review['STREAM_SIGNING_KEY']=secret;envsave('/etc/diting-review.env',review)
    call(['chown','-R','diting-review:diting-review',str(inbox)])
    python=str(ROOT/'.venv-review/bin/python')
    cfg={'logLevel':'warn','rtsp':False,'rtmp':True,'rtmpEncryption':'strict','rtmpsAddress':':1936',
         'rtmpServerKey':'/run/credentials/diting-stream.service/tls.key','rtmpServerCert':'/run/credentials/diting-stream.service/tls.crt',
         'hls':False,'webrtc':False,'srt':False,'moq':False,'api':False,'authMethod':'http','authHTTPAddress':'http://127.0.0.1:18778/auth','authHTTPExclude':[],
         'pathDefaults':{'overridePublisher':False,'record':True,'recordPath':str(inbox)+'/%path/%s-%f','recordFormat':'fmp4','recordPartDuration':'1s','recordSegmentDuration':'60s','recordDeleteAfter':'0s',
          'runOnReady':python+' -m backend.live_hook ready','runOnNotReady':python+' -m backend.live_hook stop','runOnRecordSegmentComplete':python+' -m backend.live_hook segment'},
         'paths':{'~^[0-9a-f-]{36}$':{}}}
    save('/etc/diting-mediamtx.json',json.dumps(cfg),0o644)
    common=f'''User=diting-review
Group=diting-review
WorkingDirectory={ROOT}
Restart=on-failure
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
'''
    save('/etc/systemd/system/diting-live.service',f'''[Unit]
Description=Diting live recording and company ASR
After=network.target docker.service
[Service]
{common}EnvironmentFile=/etc/diting-review.env
EnvironmentFile=/etc/diting-live.env
ReadWritePaths={data}
ExecStart={python} -m backend.live_service
[Install]
WantedBy=multi-user.target
''',0o644)
    save('/etc/systemd/system/diting-stream.service',f'''[Unit]
Description=Diting encrypted OBS receiver
After=network.target diting-live.service
Requires=diting-live.service
[Service]
{common}Environment=LIVE_INBOX={inbox}
ReadWritePaths={inbox}
LoadCredential=tls.key:/etc/letsencrypt/live/{DOMAIN}/privkey.pem
LoadCredential=tls.crt:/etc/letsencrypt/live/{DOMAIN}/fullchain.pem
ExecStart={binary} /etc/diting-mediamtx.json
[Install]
WantedBy=multi-user.target
''',0o644)
    # Reload only this receiver after successful renewal; no certificate copies or global nginx changes.
    save('/etc/letsencrypt/renewal-hooks/deploy/diting-stream',f'''#!/bin/sh
if [ "$RENEWED_LINEAGE" = "/etc/letsencrypt/live/{DOMAIN}" ]; then
 systemctl try-restart diting-stream.service
fi
''',0o700)
    site=Path('/etc/nginx/sites-available/diting-review');original=site.read_text()
    if '# Diting signed ASR audio' not in original:
        anchor=' location / {\n  proxy_pass http://127.0.0.1:18776;'
        if original.count(anchor)!=1:raise RuntimeError('unexpected nginx layout')
        site.write_text(original.replace(anchor,''' # Diting signed ASR audio
 location /asr-audio/ {
  auth_basic off;
  limit_except GET { deny all; }
  proxy_pass http://127.0.0.1:18778/;
  proxy_set_header Range $http_range;
  proxy_buffering off;
 }
'''+anchor))
    try:call(['nginx','-t'])
    except Exception:site.write_text(original);raise
    call(['systemctl','daemon-reload'])
    for service in ('diting-live','diting-stream'):
        call(['systemctl','enable','--now',service]);call(['systemctl','restart',service])
    call(['systemctl','restart','diting-review']);call(['systemctl','reload','nginx'])
    print('RTMPS receiver and ASR worker deployed; no OBS stream started')


if __name__=='__main__':main()
