BEGIN;

CREATE SCHEMA IF NOT EXISTS diting;

CREATE TABLE IF NOT EXISTS diting.live_sessions (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    live_room_id text NOT NULL,
    author_id text,
    anchor_name text,
    operator_name text,
    live_status text NOT NULL DEFAULT '整场'
        CHECK (live_status IN ('整场', '断播', '重开')),
    started_at timestamptz NOT NULL,
    ended_at timestamptz,
    is_holiday boolean,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK (ended_at IS NULL OR ended_at > started_at),
    UNIQUE (live_room_id, started_at)
);

CREATE TABLE IF NOT EXISTS diting.capture_snapshots (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    session_id bigint NOT NULL
        REFERENCES diting.live_sessions(id) ON DELETE CASCADE,
    request_id text NOT NULL UNIQUE,
    captured_at timestamptz NOT NULL,
    live_room_exposure_uv bigint,
    product_exposure_uv bigint,
    product_click_uv bigint,
    buyer_uv bigint,
    cumulative_watch_uv bigint,
    new_fans bigint,
    buyer_fan_rate numeric(9, 6),
    avg_stay_duration_seconds numeric(12, 2),
    gmv numeric(16, 2),
    cost numeric(16, 2),
    natural_recommend numeric(16, 6),
    natural_follow numeric(16, 6),
    natural_search numeric(16, 6),
    natural_short_video numeric(16, 6),
    other_traffic_rate numeric(9, 6),
    source_status jsonb NOT NULL DEFAULT '{}'::jsonb,
    raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
    screenshot_filename text,
    screenshot_mime_type text,
    screenshot_path text,
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK (buyer_fan_rate IS NULL OR buyer_fan_rate >= 0),
    CHECK (other_traffic_rate IS NULL OR other_traffic_rate >= 0)
);

CREATE INDEX IF NOT EXISTS capture_snapshots_session_time_idx
    ON diting.capture_snapshots (session_id, captured_at DESC);

CREATE TABLE IF NOT EXISTS diting.online_samples (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    session_id bigint NOT NULL
        REFERENCES diting.live_sessions(id) ON DELETE CASCADE,
    sampled_at timestamptz NOT NULL,
    received_at timestamptz NOT NULL DEFAULT now(),
    online_count integer,
    is_stale boolean NOT NULL DEFAULT false,
    raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
    CHECK (online_count IS NULL OR online_count >= 0),
    UNIQUE (session_id, sampled_at)
);

CREATE INDEX IF NOT EXISTS online_samples_session_time_idx
    ON diting.online_samples (session_id, sampled_at);

CREATE TABLE IF NOT EXISTS diting.transcript_lines (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    session_id bigint NOT NULL
        REFERENCES diting.live_sessions(id) ON DELETE CASCADE,
    offset_ms bigint NOT NULL CHECK (offset_ms >= 0),
    speaker text,
    content text NOT NULL,
    topic text,
    source text,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (session_id, offset_ms, content)
);

CREATE INDEX IF NOT EXISTS transcript_lines_session_offset_idx
    ON diting.transcript_lines (session_id, offset_ms);

CREATE TABLE IF NOT EXISTS diting.reviews (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    session_id bigint NOT NULL
        REFERENCES diting.live_sessions(id) ON DELETE CASCADE,
    range_start_seconds integer NOT NULL DEFAULT 0
        CHECK (range_start_seconds >= 0),
    range_end_seconds integer,
    period_theme text CHECK (
        period_theme IS NULL OR char_length(period_theme) <= 16
    ),
    keywords text[] NOT NULL DEFAULT '{}',
    conclusion text,
    adjustment text,
    saved_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK (
        range_end_seconds IS NULL
        OR range_end_seconds > range_start_seconds
    ),
    UNIQUE (session_id, range_start_seconds, range_end_seconds)
);

COMMIT;
