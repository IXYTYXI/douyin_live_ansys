"""One-time read-only import of a stopped legacy queue into PostgreSQL."""
import argparse
import sqlite3
from pathlib import Path
from psycopg import sql
from .pipeline import Pipeline


def migrate(source, pipeline):
    source = Path(source).resolve(strict=True)
    legacy = sqlite3.connect(source.as_uri() + '?mode=ro', uri=True)
    legacy.row_factory = sqlite3.Row
    try:
        business = legacy.execute("SELECT value FROM settings WHERE key='business'").fetchone()
        if not business or business[0] != pipeline.business:
            raise ValueError('legacy business namespace differs')
        with pipeline.db() as db:
            db.execute('SELECT pg_advisory_xact_lock(hashtext(%s))', (pipeline.schema,))
            # Stop all old and new workers during migration. No ambiguous merges.
            if db.execute('SELECT 1 FROM sessions LIMIT 1').fetchone():
                raise ValueError('destination must contain no sessions')
            counts = {}
            for table in ('sessions', 'recordings', 'segments'):
                rows = legacy.execute('SELECT * FROM ' + table).fetchall()
                counts[table] = len(rows)
                for row in rows:
                    value = dict(row)
                    if table == 'segments':
                        # Old tasks used the segment hash remotely: retain it for polling/retry.
                        value['task_id'] = value['id']
                        value['owner'], value['lease'] = None, 0
                    columns = list(value)
                    db.execute(sql.SQL('INSERT INTO {} ({}) VALUES ({})').format(
                        sql.Identifier(table), sql.SQL(',').join(map(sql.Identifier, columns)),
                        sql.SQL(',').join(sql.Placeholder() for _ in columns)), list(value.values()))
            cooldown = legacy.execute("SELECT value FROM settings WHERE key='cooldown'").fetchone()
            if cooldown:
                db.execute("INSERT INTO settings VALUES ('cooldown',%s) ON CONFLICT(key) DO UPDATE SET value=excluded.value", (cooldown[0],))
        return counts
    finally:
        legacy.close()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('source', help='Stopped legacy pipeline.sqlite (read-only)')
    parser.add_argument('--data', required=True, help='Existing media root; retain the media/ directory')
    parser.add_argument('--business', default='douyin')
    args = parser.parse_args()
    print(migrate(args.source, Pipeline(args.data, business=args.business)))


if __name__ == '__main__':
    main()
