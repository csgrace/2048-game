CREATE TABLE IF NOT EXISTS public.game_profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    username VARCHAR(20) UNIQUE NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.game_saves (
    user_id UUID NOT NULL REFERENCES public.game_profiles(id) ON DELETE CASCADE,
    grid_size SMALLINT NOT NULL CHECK (grid_size IN (4, 6, 8)),
    board JSONB NOT NULL,
    score INTEGER NOT NULL CHECK (score >= 0),
    steps INTEGER NOT NULL CHECK (steps >= 0),
    elapsed_ms BIGINT NOT NULL CHECK (elapsed_ms >= 0),
    timer_mode VARCHAR(16) NOT NULL,
    saved_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, grid_size)
);

CREATE TABLE IF NOT EXISTS public.game_records (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES public.game_profiles(id) ON DELETE CASCADE,
    grid_size SMALLINT NOT NULL CHECK (grid_size IN (4, 6, 8)),
    max_tile INTEGER NOT NULL CHECK (max_tile >= 2),
    score INTEGER NOT NULL CHECK (score >= 0),
    steps INTEGER NOT NULL CHECK (steps >= 0),
    duration_ms BIGINT NOT NULL CHECK (duration_ms >= 0),
    completed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_game_records_grid_rank
    ON public.game_records(grid_size, max_tile DESC, score DESC, duration_ms ASC);
CREATE INDEX IF NOT EXISTS idx_game_records_user_time
    ON public.game_records(user_id, grid_size, completed_at DESC);

ALTER TABLE public.game_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.game_saves ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.game_records ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.game_leaderboard(requested_grid_size SMALLINT)
RETURNS TABLE(username VARCHAR, "maxTile" INTEGER, score INTEGER, steps INTEGER, "durationMs" BIGINT, "completedAt" TIMESTAMPTZ)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT DISTINCT ON (r.user_id)
        p.username, r.max_tile, r.score, r.steps, r.duration_ms, r.completed_at
    FROM public.game_records r
    JOIN public.game_profiles p ON p.id = r.user_id
    WHERE r.grid_size = requested_grid_size
    ORDER BY r.user_id, r.max_tile DESC, r.score DESC, r.duration_ms ASC, r.completed_at ASC;
$$;

GRANT EXECUTE ON FUNCTION public.game_leaderboard(SMALLINT) TO anon, authenticated;
