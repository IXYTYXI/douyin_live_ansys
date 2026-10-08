"""Add an upload-only endpoint to the existing authenticated review deployment.
Run after git pull. Credentials stay in root-only environment files.
"""
import json
import secrets
import subprocess
from pathlib import Path
import psycopg
from psycopg import sql
from psycopg.conninfo import make_conninfo, conninfo_to_dict


def call(args):
    subprocess.run(args, check=True, stdout=subprocess.DEVNULL)


def install():
    root = Path(__file__).resolve().parents[2]
    review = dict((k, json.loads(v)) for k, v in
                  (line.split('=', 1) for line in Path('/etc/diting-review.env').read_text().splitlines() if '=' in line))
    # Resolve the existing isolated database, never a guessed business database.
    connection = conninfo_to_dict(review['REVIEW_DATABASE_URL'])
    if connection['dbname'] != 'diting_plugin_test_20261008':
        raise SystemExit('Unexpected database; refuse deployment')
    path = Path('/etc/diting-ingest.env')
    previous = dict((k, json.loads(v)) for k, v in
                    (line.split('=', 1) for line in path.read_text().splitlines() if '=' in line)) if path.exists() else {}
    password = conninfo_to_dict(previous['METRICS_DATABASE_URL'])['password'] if previous else secrets.token_urlsafe(32)
    token = previous.get('METRICS_API_KEY') or secrets.token_urlsafe(32)
    meta = json.loads(subprocess.check_output(['docker', 'inspect', 'postgres']))[0]
    env = dict(x.split('=', 1) for x in meta['Config']['Env'] if '=' in x)
    role = 'diting_metrics_ingest'
    with psycopg.connect(host='127.0.0.1', port=5432, user=env.get('POSTGRES_USER', 'postgres'),
                          password=env['POSTGRES_PASSWORD'], dbname=connection['dbname']) as db:
        db.execute((root/'backend/migrations/001_metrics.sql').read_text())
        db.execute((root/'backend/migrations/007_collector_ends.sql').read_text())
        db.execute('GRANT SELECT ON diting_metrics.run_ends TO diting_review_reader')
        if not db.execute('SELECT 1 FROM pg_roles WHERE rolname=%s', (role,)).fetchone():
            db.execute(sql.SQL('CREATE ROLE {} LOGIN').format(sql.Identifier(role)))
        db.execute(sql.SQL('ALTER ROLE {} PASSWORD {}').format(sql.Identifier(role), sql.Literal(password)))
        db.execute(sql.SQL('GRANT CONNECT ON DATABASE {} TO {}').format(sql.Identifier(connection['dbname']), sql.Identifier(role)))
        db.execute(sql.SQL('GRANT USAGE ON SCHEMA diting_metrics TO {}').format(sql.Identifier(role)))
        db.execute(sql.SQL('GRANT SELECT, INSERT ON diting_metrics.samples, diting_metrics.batches, diting_metrics.run_ends TO {}').format(sql.Identifier(role)))
        db.execute(sql.SQL('GRANT USAGE ON SEQUENCE diting_metrics.samples_seq_seq TO {}').format(sql.Identifier(role)))
    values = {'METRICS_DATABASE_URL': make_conninfo(host='127.0.0.1', port=5432, user=role,
              password=password, dbname=connection['dbname']), 'METRICS_API_KEY': token}
    # Atomic replacement without a world-readable creation window.
    temporary = path.with_suffix('.tmp')
    temporary.touch(mode=0o600, exist_ok=True);temporary.chmod(0o600)
    temporary.write_text('\n'.join(k+'='+json.dumps(v) for k, v in values.items())+'\n')
    temporary.replace(path)
    unit = Path('/etc/systemd/system/diting-ingest.service')
    unit.write_text(f'''[Unit]
Description=Diting upload-only metrics inbox
After=network.target docker.service
[Service]
User=diting-review
Group=diting-review
WorkingDirectory={root}
EnvironmentFile=/etc/diting-ingest.env
ExecStart={root}/.venv-review/bin/python -m backend.ingest_service
Restart=on-failure
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadOnlyPaths={root}
[Install]
WantedBy=multi-user.target
''');unit.chmod(0o644)
    site = Path('/etc/nginx/sites-available/diting-review')
    original = site.read_text()
    marker = ' # Diting upload-only route'
    if marker not in original:
        anchor = ' location / {\n  proxy_pass http://127.0.0.1:18776;'
        if original.count(anchor) != 1:
            raise SystemExit('Unexpected nginx layout; refuse to overwrite')
        route = ''' # Diting upload-only route
 location = /api/metrics/batches {
  auth_basic off;
  client_max_body_size 2m;
  client_body_timeout 15s;
  limit_except POST { deny all; }
  proxy_pass http://127.0.0.1:18777;
  proxy_set_header Authorization $http_authorization;
  proxy_set_header Host $host;
  proxy_connect_timeout 5s;
  proxy_read_timeout 45s;
 }
'''
        site.write_text(original.replace(anchor, route+anchor))
    try:
        call(['nginx', '-t'])
    except Exception:
        site.write_text(original)
        raise
    call(['systemctl', 'daemon-reload'])
    call(['systemctl', 'enable', '--now', 'diting-ingest'])
    call(['systemctl', 'restart', 'diting-ingest'])
    call(['systemctl', 'reload', 'nginx'])
    print('Upload-only HTTPS endpoint deployed; credentials preserved')


if __name__ == '__main__':
    install()
