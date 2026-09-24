-- Additive migration: existing business rows and commerce columns are retained.
ALTER TABLE diting.capture_snapshots ADD COLUMN IF NOT EXISTS online_count bigint;
ALTER TABLE diting.capture_snapshots ADD COLUMN IF NOT EXISTS preview_online bigint;
ALTER TABLE diting.capture_snapshots ADD COLUMN IF NOT EXISTS gift_users bigint;
ALTER TABLE diting.capture_snapshots ADD COLUMN IF NOT EXISTS comment_users bigint;
ALTER TABLE diting.capture_snapshots ADD COLUMN IF NOT EXISTS likes bigint;
ALTER TABLE diting.capture_snapshots ADD COLUMN IF NOT EXISTS shares bigint;
ALTER TABLE diting.capture_snapshots ADD COLUMN IF NOT EXISTS fan_club_joins bigint;
ALTER TABLE diting.capture_snapshots ADD COLUMN IF NOT EXISTS average_stay_raw text;
CREATE TABLE IF NOT EXISTS diting.capture_run_bindings (
    run_id text PRIMARY KEY,
    session_id bigint NOT NULL REFERENCES diting.live_sessions(id),
    bound_at timestamptz NOT NULL DEFAULT now()
);
