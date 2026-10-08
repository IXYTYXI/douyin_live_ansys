CREATE SCHEMA IF NOT EXISTS diting_review;
CREATE TABLE IF NOT EXISTS diting_review.notes (
 session_id text NOT NULL, scope text NOT NULL CHECK(scope IN ('range','session')),
 start_ms bigint NOT NULL CHECK(start_ms>=0), end_ms bigint NOT NULL CHECK(end_ms>start_ms),
 fields jsonb NOT NULL, version integer NOT NULL DEFAULT 1,
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(session_id,scope,start_ms,end_ms)
);
CREATE TABLE IF NOT EXISTS diting_review.summaries (
 session_id text NOT NULL, start_ms bigint NOT NULL, end_ms bigint NOT NULL,
 input_hash text NOT NULL, model text NOT NULL, status text NOT NULL,
 fields jsonb, attempts integer NOT NULL DEFAULT 0, next_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(session_id,start_ms,end_ms)
);
