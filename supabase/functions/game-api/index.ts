import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': 'https://csgrace.github.io',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8' },
});

const validGrid = (value: unknown): boolean => [4, 6, 8].includes(Number(value));
const validBoard = (board: unknown, size: number): board is number[][] => Array.isArray(board) &&
  board.length === size &&
  board.every((row) => Array.isArray(row) && row.length === size && row.every((tile) =>
    Number.isInteger(tile) && tile >= 0 && (tile === 0 || (tile >= 2 && (tile & (tile - 1)) === 0))));

const maxTile = (board: number[][]) => Math.max(...board.flat());

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const url = new URL(request.url);
  const parts = url.pathname.replace(/^\/game-api\/?/, '').split('/').filter(Boolean);
  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  try {
    // This route is deliberately public. It only returns published scores and display names.
    if (request.method === 'GET' && parts[0] === 'leaderboard' && validGrid(parts[1])) {
      const gridSize = Number(parts[1]);
      const { data: records, error: recordsError } = await admin
        .from('game_records')
        .select('user_id,max_tile,score,steps,duration_ms,completed_at')
        .eq('grid_size', gridSize);
      if (recordsError) throw recordsError;

      const bestByUser = new Map<string, Record<string, unknown>>();
      for (const record of records ?? []) {
        const current = bestByUser.get(record.user_id) as typeof record | undefined;
        const isBetter = !current ||
          record.max_tile > current.max_tile ||
          (record.max_tile === current.max_tile && (record.score > current.score ||
            (record.score === current.score && Number(record.duration_ms) < Number(current.duration_ms))));
        if (isBetter) bestByUser.set(record.user_id, record);
      }

      const ids = [...bestByUser.keys()];
      const { data: profiles, error: profilesError } = ids.length
        ? await admin.from('game_profiles').select('id,username').in('id', ids)
        : { data: [], error: null };
      if (profilesError) throw profilesError;

      const names = new Map((profiles ?? []).map((profile) => [profile.id, profile.username]));
      const leaderboard = [...bestByUser.values()].map((record) => ({
        username: names.get(record.user_id as string) ?? 'Player',
        maxTile: record.max_tile,
        score: record.score,
        steps: record.steps,
        durationMs: Number(record.duration_ms),
        completedAt: record.completed_at,
      })).sort((a, b) => Number(b.maxTile) - Number(a.maxTile) || Number(b.score) - Number(a.score) || a.durationMs - b.durationMs);

      return json(leaderboard);
    }

    if (request.method === 'POST' && parts.join('/') === 'auth/register') {
      const { username, password } = await request.json();
      if (!/^[\w-]{3,20}$/.test(username ?? '') || typeof password !== 'string' || password.length < 6) {
        return json({ error: 'Username must be 3–20 characters; password must be at least 6 characters.' }, 400);
      }
      const email = `${username.toLowerCase()}@game2048.local`;
      const { data, error } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { username },
      });
      if (error || !data.user) return json({ error: error?.message ?? 'Could not create user.' }, 409);

      const { error: profileError } = await admin.from('game_profiles').insert({ id: data.user.id, username });
      if (profileError) throw profileError;

      const { data: login, error: loginError } = await admin.auth.signInWithPassword({ email, password });
      if (loginError || !login.session) throw loginError ?? new Error('Could not start session.');
      return json({ user: { username }, token: login.session.access_token }, 201);
    }

    if (request.method === 'POST' && parts.join('/') === 'auth/login') {
      const { username, password } = await request.json();
      const email = `${String(username ?? '').toLowerCase()}@game2048.local`;
      const { data, error } = await admin.auth.signInWithPassword({ email, password });
      if (error || !data.session || !data.user) return json({ error: 'Invalid username or password.' }, 401);
      const { data: profile } = await admin.from('game_profiles').select('username').eq('id', data.user.id).maybeSingle();
      return json({ user: { username: profile?.username ?? username }, token: data.session.access_token });
    }

    const token = request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '');
    const { data: authData, error: authError } = token ? await admin.auth.getUser(token) : { data: { user: null }, error: null };
    if (authError || !authData.user) return json({ error: 'Please log in first.' }, 401);
    const user = authData.user;

    const gridSize = Number(parts.at(-1));
    if (!validGrid(gridSize)) return json({ error: 'Invalid grid size.' }, 400);

    if (parts[0] === 'saves' && request.method === 'PUT') {
      const payload = await request.json();
      if (!validBoard(payload.board, gridSize) || !Number.isInteger(payload.score) || !Number.isInteger(payload.steps) || !Number.isInteger(payload.elapsedMs)) {
        return json({ error: 'Invalid save data.' }, 400);
      }
      const { error } = await admin.from('game_saves').upsert({
        user_id: user.id, grid_size: gridSize, board: payload.board, score: payload.score,
        steps: payload.steps, elapsed_ms: payload.elapsedMs, timer_mode: payload.timerMode ?? 'up',
      }, { onConflict: 'user_id,grid_size' });
      if (error) throw error;
      return json({ ok: true });
    }

    if (parts[0] === 'saves' && request.method === 'GET') {
      const { data, error } = await admin.from('game_saves').select('board,score,steps,elapsed_ms,timer_mode')
        .eq('user_id', user.id).eq('grid_size', gridSize).maybeSingle();
      if (error) throw error;
      return data ? json({ board: data.board, score: data.score, steps: data.steps, elapsedMs: Number(data.elapsed_ms), timerMode: data.timer_mode }) : json({ error: 'No save found.' }, 404);
    }

    if (parts[0] === 'records' && request.method === 'POST') {
      const payload = await request.json();
      if (!validBoard(payload.board, gridSize) || !Number.isInteger(payload.score) || !Number.isInteger(payload.steps) || !Number.isInteger(payload.durationMs)) {
        return json({ error: 'Invalid game record.' }, 400);
      }
      const { error } = await admin.from('game_records').insert({
        user_id: user.id, grid_size: gridSize, max_tile: maxTile(payload.board), score: payload.score,
        steps: payload.steps, duration_ms: payload.durationMs,
      });
      if (error) throw error;
      return json({ ok: true }, 201);
    }

    if (parts[0] === 'records' && parts[1] === 'me' && request.method === 'GET') {
      const { data, error } = await admin.from('game_records').select('max_tile,score,steps,duration_ms,completed_at')
        .eq('user_id', user.id).eq('grid_size', gridSize).order('completed_at', { ascending: false });
      if (error) throw error;
      return json((data ?? []).map((record) => ({
        maxTile: record.max_tile, score: record.score, steps: record.steps,
        durationMs: Number(record.duration_ms), completedAt: record.completed_at,
      })));
    }

    return json({ error: 'Not found.' }, 404);
  } catch (error) {
    console.error(JSON.stringify(error));
    return json({ error: error instanceof Error ? error.message : 'Server error.' }, 500);
  }
});
