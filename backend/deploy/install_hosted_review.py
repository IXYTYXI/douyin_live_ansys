"""Deploy the selected read-only recording after authorized git pull.
Accept JSON with password/session/run/teacher on stdin. Never print secrets.
"""
import json, os, secrets, subprocess, sys
from pathlib import Path

def call(args, **kw): return subprocess.run(args, check=True, **kw)
def save(path, text, mode=0o600):
    path=Path(path);path.write_text(text);path.chmod(mode)

cfg=json.load(sys.stdin)
domain='live-ansys.ai.lab.yc345.tv'
root=Path(__file__).resolve().parents[2]
venv=root/'.venv-review'
if not venv.exists(): call(['python3','-m','venv',str(venv)])
call([str(venv/'bin/pip'),'install','-r',str(root/'backend/requirements.txt')],stdout=subprocess.DEVNULL)
# Re-exec with installed driver, retaining config via stdin.
if sys.prefix != str(venv):
    result=subprocess.run([str(venv/'bin/python'),__file__],input=json.dumps(cfg),text=True)
    raise SystemExit(result.returncode)
import psycopg
from psycopg import sql
from psycopg.conninfo import make_conninfo
meta=json.loads(subprocess.check_output(['docker','inspect','postgres']))[0]
env=dict(x.split('=',1) for x in meta['Config']['Env'] if '=' in x)
role='diting_review_reader';password=secrets.token_urlsafe(32)
with psycopg.connect(host='127.0.0.1',port=5432,user=env.get('POSTGRES_USER','postgres'),password=env['POSTGRES_PASSWORD'],dbname='diting_plugin_test_20261008',autocommit=True) as db:
    if not db.execute('SELECT 1 FROM pg_roles WHERE rolname=%s',(role,)).fetchone():
        db.execute(sql.SQL('CREATE ROLE {} LOGIN').format(sql.Identifier(role)))
    db.execute(sql.SQL('ALTER ROLE {} PASSWORD {}').format(sql.Identifier(role),sql.Literal(password)))
    db.execute(sql.SQL('GRANT CONNECT ON DATABASE diting_plugin_test_20261008 TO {}').format(sql.Identifier(role)))
    for schema in ['diting_metrics','diting_asr_douyin_recording_test']:
        db.execute(sql.SQL('GRANT USAGE ON SCHEMA {} TO {}').format(sql.Identifier(schema),sql.Identifier(role)))
        db.execute(sql.SQL('GRANT SELECT ON ALL TABLES IN SCHEMA {} TO {}').format(sql.Identifier(schema),sql.Identifier(role)))
    db.execute(sql.SQL('ALTER ROLE {} SET default_transaction_read_only = on').format(sql.Identifier(role)))
if subprocess.run(['id','diting-review'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL).returncode:
    call(['useradd','--system','--no-create-home','--shell','/usr/sbin/nologin','diting-review'])
data=Path('/var/lib/diting-review');(data/'media').mkdir(parents=True,exist_ok=True)
call(['chown','-R','diting-review:diting-review',str(data)])
proxy=secrets.token_urlsafe(32)
values={'REVIEW_DATABASE_URL':make_conninfo(host='127.0.0.1',port=5432,user=role,password=password,dbname='diting_plugin_test_20261008'),'REVIEW_API_KEY':proxy,'MEDIA_SIGNING_KEY':secrets.token_urlsafe(32),'DATA_DIR':str(data),'PUBLIC_BASE_URL':'https://'+domain,'REVIEW_SESSION':cfg['session'],'REVIEW_METRICS_RUN':cfg['run'],'REVIEW_TEACHER':cfg['teacher']}
save('/etc/diting-review.env','\n'.join(k+'='+json.dumps(v,ensure_ascii=False) for k,v in values.items())+'\n')
hashed=subprocess.check_output(['openssl','passwd','-6','-stdin'],input=cfg['password']+'\n',text=True).strip()
save('/etc/nginx/diting-review.htpasswd','review:'+hashed+'\n',0o640)
call(['chown','root:www-data','/etc/nginx/diting-review.htpasswd'])
save('/etc/systemd/system/diting-review.service',f'''[Unit]
Description=Diting authenticated read-only review
After=network.target docker.service
[Service]
User=diting-review
Group=diting-review
WorkingDirectory={root}
EnvironmentFile=/etc/diting-review.env
ExecStart={venv}/bin/python -m backend.hosted_review
Restart=on-failure
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadOnlyPaths={root} {data}
[Install]
WantedBy=multi-user.target
''',0o644)
site=Path('/etc/nginx/sites-available/diting-review')
bootstrap=f'''server {{
 listen 80;
 server_name {domain};
 location /.well-known/acme-challenge/ {{ root /var/www/html; }}
 location / {{ return 301 https://$host$request_uri; }}
}}
'''
if not site.exists(): save(site,bootstrap,0o644)
link=Path('/etc/nginx/sites-enabled/diting-review')
if not link.exists(): link.symlink_to(site)
call(['nginx','-t']);call(['systemctl','reload','nginx'])
call(['certbot','certonly','--webroot','-w','/var/www/html','-d',domain,'--non-interactive','--keep-until-expiring'])
save(site,bootstrap+f'''server {{
 listen 443 ssl;
 server_name {domain};
 ssl_certificate /etc/letsencrypt/live/{domain}/fullchain.pem;
 ssl_certificate_key /etc/letsencrypt/live/{domain}/privkey.pem;
 include /etc/letsencrypt/options-ssl-nginx.conf;
 auth_basic "Diting review";
 auth_basic_user_file /etc/nginx/diting-review.htpasswd;
 access_log off;
 error_log /var/log/nginx/diting-review.error.log crit;
 add_header X-Content-Type-Options nosniff always;
 add_header X-Frame-Options SAMEORIGIN always;
 add_header Referrer-Policy no-referrer always;
 location / {{
  proxy_pass http://127.0.0.1:18776;
  proxy_set_header X-Diting-Proxy {proxy};
  proxy_set_header Host $host;
  proxy_set_header Range $http_range;
  proxy_buffering off;
 }}
}}
''',0o644)
call(['nginx','-t']);call(['systemctl','daemon-reload']);call(['systemctl','enable','--now','diting-review']);call(['systemctl','restart','diting-review']);call(['systemctl','reload','nginx'])
print('Authenticated review deployed')
