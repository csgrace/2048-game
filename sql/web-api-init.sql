CREATE TABLE IF NOT EXISTS web_users (
    id BIGSERIAL PRIMARY KEY,
    username VARCHAR(20) UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS web_saves (
    user_id BIGINT NOT NULL REFERENCES web_users(id) ON DELETE CASCADE,
    grid_size SMALLINT NOT NULL CHECK (grid_size IN (4, 6, 8)),
    board JSONB NOT NULL,
    score INTEGER NOT NULL CHECK (score >= 0),
    steps INTEGER NOT NULL CHECK (steps >= 0),
    elapsed_ms BIGINT NOT NULL CHECK (elapsed_ms >= 0),
    timer_mode VARCHAR(16) NOT NULL,
    saved_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, grid_size)
);

CREATE TABLE IF NOT EXISTS web_game_records (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES web_users(id) ON DELETE CASCADE,
    grid_size SMALLINT NOT NULL CHECK (grid_size IN (4, 6, 8)),
    max_tile INTEGER NOT NULL CHECK (max_tile >= 2),
    score INTEGER NOT NULL CHECK (score >= 0),
    steps INTEGER NOT NULL CHECK (steps >= 0),
    duration_ms BIGINT NOT NULL CHECK (duration_ms >= 0),
    completed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_web_records_grid_rank
    ON web_game_records(grid_size, max_tile DESC, score DESC, duration_ms ASC);
CREATE INDEX IF NOT EXISTS idx_web_records_user_time
    ON web_game_records(user_id, grid_size, completed_at DESC);
