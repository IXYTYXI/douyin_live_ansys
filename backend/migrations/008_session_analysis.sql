CREATE SCHEMA IF NOT EXISTS diting_review;
CREATE TABLE IF NOT EXISTS diting_review.session_analyses (
 session_id text PRIMARY KEY,
 input_hash text NOT NULL, model text NOT NULL,
 status text NOT NULL CHECK(status IN ('processing','done','failed')),
 payload jsonb NOT NULL, output jsonb,
 attempts integer NOT NULL DEFAULT 0,
 next_at timestamptz NOT NULL DEFAULT now(),
 error_type text, generated_at timestamptz,
 updated_at timestamptz NOT NULL DEFAULT now()
);
