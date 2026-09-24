CREATE SCHEMA IF NOT EXISTS diting_metrics;
CREATE TABLE IF NOT EXISTS diting_metrics.samples (
    seq BIGSERIAL UNIQUE NOT NULL,
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL,
    captured_at TIMESTAMPTZ NOT NULL,
    payload TEXT NOT NULL,
    received_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS samples_run_time ON diting_metrics.samples(run_id, captured_at);
CREATE INDEX IF NOT EXISTS samples_run_seq ON diting_metrics.samples(run_id, seq);
CREATE TABLE IF NOT EXISTS diting_metrics.batches (id TEXT PRIMARY KEY, payload TEXT NOT NULL);
