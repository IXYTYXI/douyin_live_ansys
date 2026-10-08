CREATE TABLE IF NOT EXISTS diting_metrics.run_ends (
 run_id TEXT PRIMARY KEY,
 payload TEXT NOT NULL,
 verified BOOLEAN NOT NULL,
 received_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
