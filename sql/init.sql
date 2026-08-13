-- =============================================================
--  2048 – PostgreSQL schema (v2 – multi-grid + per-grid leaderboards)
--  Run once against a fresh database:
--      psql -U postgres -d game2048 -f sql/init.sql
--
--  NOTE: if you have an old v1 schema, drop the tables first:
--      DROP TABLE IF EXISTS scores, saves, users CASCADE;
-- =============================================================

CREATE TABLE IF NOT EXISTS users (
    id            SERIAL PRIMARY KEY,
    username      VARCHAR(64) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    created_at    TIMESTAMP DEFAULT now()
);

CREATE TABLE IF NOT EXISTS scores (
    id         SERIAL PRIMARY KEY,
    user_id    INTEGER REFERENCES users(id) ON DELETE CASCADE,
    score      INTEGER NOT NULL DEFAULT 0,
    steps      INTEGER NOT NULL DEFAULT 0,
    duration_s INTEGER NOT NULL DEFAULT 0,
    grid_size  INTEGER NOT NULL DEFAULT 4,        -- 4, 6, or 8
    achieved   TIMESTAMP DEFAULT now()
);

CREATE TABLE IF NOT EXISTS saves (
    user_id    INTEGER REFERENCES users(id) ON DELETE CASCADE,
    grid_size  INTEGER NOT NULL DEFAULT 4,        -- 4, 6, or 8
    board      INTEGER[] NOT NULL DEFAULT '{}',   -- variable length per grid
    score      INTEGER NOT NULL DEFAULT 0,
    steps      INTEGER NOT NULL DEFAULT 0,
    elapsed_ms BIGINT NOT NULL DEFAULT 0,
    saved_at   TIMESTAMP DEFAULT now(),
    PRIMARY KEY (user_id, grid_size)
);

-- handy indices
CREATE INDEX IF NOT EXISTS idx_scores_user_grid ON scores(grid_size, score DESC);
CREATE INDEX IF NOT EXISTS idx_scores_value     ON scores(score DESC);
CREATE INDEX IF NOT EXISTS idx_saves_user       ON saves(user_id);
