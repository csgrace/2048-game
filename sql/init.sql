-- =============================================================
--  2048 – PostgreSQL schema
--  Run once against a fresh database:
--      psql -U postgres -d game2048 -f sql/init.sql
-- =============================================================

CREATE TABLE IF NOT EXISTS users (
    id            SERIAL PRIMARY KEY,
    username      VARCHAR(64) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    created_at    TIMESTAMP DEFAULT now()
);

CREATE TABLE IF NOT EXISTS scores (
    id         SERIAL PRIMARY KEY,
    user_id    INTEGER REFERENCES users(id),
    score      INTEGER NOT NULL DEFAULT 0,
    steps      INTEGER NOT NULL DEFAULT 0,
    duration_s INTEGER NOT NULL DEFAULT 0,
    achieved   TIMESTAMP DEFAULT now()
);

CREATE TABLE IF NOT EXISTS saves (
    user_id    INTEGER PRIMARY KEY REFERENCES users(id),
    board      INTEGER[16] NOT NULL DEFAULT '{0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0}',
    score      INTEGER NOT NULL DEFAULT 0,
    steps      INTEGER NOT NULL DEFAULT 0,
    elapsed_ms BIGINT NOT NULL DEFAULT 0,
    saved_at   TIMESTAMP DEFAULT now()
);

-- handy indices
CREATE INDEX IF NOT EXISTS idx_scores_user  ON scores(user_id);
CREATE INDEX IF NOT EXISTS idx_scores_value ON scores(score DESC);
