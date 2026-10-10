"""Add nullable audio evidence without modifying source media, ASR text or human notes."""
import argparse
import json
import subprocess
from pathlib import Path
import psycopg
from psycopg import sql
from psycopg.conninfo import conninfo_to_dict,make_conninfo
from backend.lark_sync_service import read_env
from backend.pipeline import Pipeline
from backend.audio_quality import backfill


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--backfill-session')
    args=parser.parse_args()
    env=read_env('/etc/diting-review.env');review=conninfo_to_dict(env['REVIEW_DATABASE_URL'])
    container=json.loads(subprocess.check_output(['docker','inspect','postgres']))[0]
    pg=dict(v.split('=',1) for v in container['Config']['Env'] if '=' in v)
    admin=make_conninfo(host=review.get('host','127.0.0.1'),port=review.get('port','5432'),user=pg.get('POSTGRES_USER','postgres'),password=pg['POSTGRES_PASSWORD'],dbname=review['dbname'])
    schemas=('diting_asr_douyin_live','diting_asr_douyin_recording_test')
    existing=[]
    with psycopg.connect(admin) as db:
        db.execute("SET LOCAL lock_timeout='5s'")
        for schema in schemas:
            if not db.execute('SELECT to_regclass(%s)',(schema+'.segments',)).fetchone()[0]:continue
            db.execute(sql.SQL('ALTER TABLE {}.segments ADD COLUMN IF NOT EXISTS audio_quality JSONB').format(sql.Identifier(schema)))
            existing.append(schema)
    print('Audio evidence column ready.',flush=True)
    if args.backfill_session:
        for schema in existing:
            p=Pipeline.__new__(Pipeline);p.root=Path(env['DATA_DIR']);p.schema=schema;p.database_url=admin
            count=0
            while True:
                n=backfill(p,limit=20,session_id=args.backfill_session)
                count+=n
                if not n:break
            print(f'{schema}: {count} existing chunks checked.',flush=True)


if __name__=='__main__':main()
