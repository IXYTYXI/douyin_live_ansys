CREATE TABLE IF NOT EXISTS diting_live.channels (
 id TEXT PRIMARY KEY,
 teacher TEXT NOT NULL UNIQUE,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE diting_live.sessions ADD COLUMN IF NOT EXISTS channel_id TEXT REFERENCES diting_live.channels(id);
ALTER TABLE diting_live.sessions ADD COLUMN IF NOT EXISTS media_end DOUBLE PRECISION;
CREATE INDEX IF NOT EXISTS sessions_channel_start ON diting_live.sessions(channel_id,started DESC);
CREATE TABLE IF NOT EXISTS diting_live.segments (
 channel_id TEXT NOT NULL REFERENCES diting_live.channels(id),
 name TEXT NOT NULL,
 session_id TEXT NOT NULL REFERENCES diting_live.sessions(id),
 PRIMARY KEY(channel_id,name)
);
CREATE INDEX IF NOT EXISTS samples_teacher_time ON diting_metrics.samples ((payload::jsonb->>'teacher'),captured_at);
