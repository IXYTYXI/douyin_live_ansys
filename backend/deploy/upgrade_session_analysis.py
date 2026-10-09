"""Apply the additive analysis migration with deployment admin credentials in memory."""
import json
import subprocess
from pathlib import Path
import psycopg
from psycopg.conninfo import conninfo_to_dict
from backend.lark_sync_service import read_env

root=Path(__file__).resolve().parents[2]
review=conninfo_to_dict(read_env('/etc/diting-review.env')['REVIEW_DATABASE_URL'])
container=json.loads(subprocess.check_output(['docker','inspect','postgres']))[0]
env=dict(v.split('=',1) for v in container['Config']['Env'] if '=' in v)
with psycopg.connect(host=review.get('host','127.0.0.1'),port=review.get('port','5432'),
                    user=env.get('POSTGRES_USER','postgres'),password=env['POSTGRES_PASSWORD'],
                    dbname=review['dbname']) as db:
    db.execute((root/'backend/migrations/008_session_analysis.sql').read_text())
    db.execute(psycopg.sql.SQL('GRANT SELECT, INSERT, UPDATE ON diting_review.session_analyses TO {}').format(psycopg.sql.Identifier(review['user'])))
print('Session analysis table ready; write grant restricted to this table.')
