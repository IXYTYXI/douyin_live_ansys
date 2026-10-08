"""Apply versioned review tables and narrowly scoped write grants."""
import json,subprocess
from pathlib import Path
import psycopg
root=Path(__file__).resolve().parents[2]
cfg=json.loads(subprocess.check_output(['docker','inspect','postgres']))[0]
env=dict(x.split('=',1) for x in cfg['Config']['Env'] if '=' in x)
with psycopg.connect(host='127.0.0.1',user=env.get('POSTGRES_USER','postgres'),password=env['POSTGRES_PASSWORD'],dbname='diting_plugin_test_20261008') as db:
 db.execute((root/'backend/migrations/004_review_notes.sql').read_text())
 db.execute('GRANT USAGE ON SCHEMA diting_review TO diting_review_reader')
 db.execute('GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA diting_review TO diting_review_reader')
 db.execute('ALTER ROLE diting_review_reader SET default_transaction_read_only = off')
print('Review tables ready; write grants restricted to review schema')
