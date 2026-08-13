import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { Pool } from 'pg';

const port = Number(process.env.PORT || 3000);
const allowedOrigin = process.env.CORS_ORIGIN || 'https://csgrace.github.io';
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

function json(res, status, body) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS'
  });
  res.end(JSON.stringify(body));
}
function hashPassword(password, salt = randomBytes(16).toString('hex')) {
  return `${salt}:${scryptSync(password, salt, 64).toString('hex')}`;
}
function verifyPassword(password, stored) {
  const [salt, expected] = stored.split(':');
  if (!salt || !expected) return false;
  const actual = scryptSync(password, salt, 64).toString('hex');
  return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(actual, 'hex'));
}
function tokenFor(userId, username) {
  const secret = process.env.TOKEN_SECRET || 'replace-this-before-production';
  const issuedAt = Date.now();
  const payload = `${userId}.${username}.${issuedAt}`;
  const signature = createHash('sha256').update(`${payload}.${secret}`).digest('hex');
  return Buffer.from(`${payload}.${signature}`).toString('base64url');
}
function auth(req) {
  try {
    const token = req.headers.authorization?.replace(/^Bearer\s+/i, '');
    if (!token) return null;
    const [id, username, issuedAt, signature] = Buffer.from(token, 'base64url').toString().split('.');
    const secret = process.env.TOKEN_SECRET || 'replace-this-before-production';
    const expected = createHash('sha256').update(`${id}.${username}.${issuedAt}.${secret}`).digest('hex');
    if (!timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(expected, 'hex'))) return null;
    return { id: Number(id), username };
  } catch { return null; }
}
function validGrid(gridSize) { return [4, 6, 8].includes(Number(gridSize)); }
function validBoard(board, gridSize) {
  return Array.isArray(board) && board.length === gridSize && board.every(row =>
    Array.isArray(row) && row.length === gridSize && row.every(value =>
      Number.isInteger(value) && value >= 0 && (value === 0 || (value >= 2 && (value & (value - 1)) === 0))));
}
function maxTile(board) { return Math.max(...board.flat()); }
async function body(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString() || '{}');
}
async function initSchema() {
  await pool.query(`
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
    CREATE INDEX IF NOT EXISTS idx_web_records_grid_rank ON web_game_records(grid_size, max_tile DESC, score DESC, duration_ms ASC);
    CREATE INDEX IF NOT EXISTS idx_web_records_user_time ON web_game_records(user_id, grid_size, completed_at DESC);
  `);
}

const server = createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return json(res, 204, {});
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (req.method === 'GET' && url.pathname === '/health') return json(res, 200, { ok: true });

    if (req.method === 'POST' && url.pathname === '/api/auth/register') {
      const { username, password } = await body(req);
      if (!/^[\w-]{3,20}$/.test(username || '') || typeof password !== 'string' || password.length < 6) return json(res, 400, { error: 'Username must be 3–20 characters; password must be at least 6 characters.' });
      const result = await pool.query('INSERT INTO web_users(username,password_hash) VALUES($1,$2) RETURNING id,username', [username, hashPassword(password)]);
      const user = result.rows[0];
      return json(res, 201, { user, token: tokenFor(user.id, user.username) });
    }
    if (req.method === 'POST' && url.pathname === '/api/auth/login') {
      const { username, password } = await body(req);
      const result = await pool.query('SELECT id,username,password_hash FROM web_users WHERE username=$1', [username]);
      const user = result.rows[0];
      if (!user || !verifyPassword(password || '', user.password_hash)) return json(res, 401, { error: 'Invalid username or password.' });
      return json(res, 200, { user: { id: user.id, username: user.username }, token: tokenFor(user.id, user.username) });
    }

    if (req.method === 'GET' && /^\/api\/leaderboard\/(4|6|8)$/.test(url.pathname)) {
      const gridSize = Number(url.pathname.split('/').pop());
      const result = await pool.query(`SELECT DISTINCT ON (r.user_id) u.username, r.max_tile AS "maxTile", r.score, r.steps, r.duration_ms AS "durationMs", r.completed_at AS "completedAt"
        FROM web_game_records r JOIN web_users u ON u.id=r.user_id WHERE r.grid_size=$1
        ORDER BY r.user_id, r.max_tile DESC, r.score DESC, r.duration_ms ASC, r.completed_at ASC`, [gridSize]);
      return json(res, 200, result.rows.sort((a,b) => b.maxTile-a.maxTile || b.score-a.score || a.durationMs-b.durationMs).slice(0, 50));
    }

    const user = auth(req);
    if (!user) return json(res, 401, { error: 'Please log in first.' });

    if (req.method === 'PUT' && /^\/api\/saves\/(4|6|8)$/.test(url.pathname)) {
      const gridSize = Number(url.pathname.split('/').pop()), data = await body(req);
      if (!validBoard(data.board, gridSize) || !Number.isInteger(data.score) || !Number.isInteger(data.steps) || !Number.isInteger(data.elapsedMs)) return json(res, 400, { error: 'Invalid save data.' });
      await pool.query(`INSERT INTO web_saves(user_id,grid_size,board,score,steps,elapsed_ms,timer_mode) VALUES($1,$2,$3,$4,$5,$6,$7)
        ON CONFLICT(user_id,grid_size) DO UPDATE SET board=EXCLUDED.board,score=EXCLUDED.score,steps=EXCLUDED.steps,elapsed_ms=EXCLUDED.elapsed_ms,timer_mode=EXCLUDED.timer_mode,saved_at=now()`,
      [user.id, gridSize, JSON.stringify(data.board), data.score, data.steps, data.elapsedMs, data.timerMode || 'up']);
      return json(res, 200, { ok: true });
    }
    if (req.method === 'GET' && /^\/api\/saves\/(4|6|8)$/.test(url.pathname)) {
      const gridSize = Number(url.pathname.split('/').pop());
      const result = await pool.query('SELECT board,score,steps,elapsed_ms AS "elapsedMs",timer_mode AS "timerMode" FROM web_saves WHERE user_id=$1 AND grid_size=$2', [user.id, gridSize]);
      return result.rowCount ? json(res, 200, result.rows[0]) : json(res, 404, { error: 'No save found.' });
    }
    if (req.method === 'POST' && /^\/api\/records\/(4|6|8)$/.test(url.pathname)) {
      const gridSize = Number(url.pathname.split('/').pop()), data = await body(req);
      if (!validBoard(data.board, gridSize) || !Number.isInteger(data.score) || !Number.isInteger(data.steps) || !Number.isInteger(data.durationMs)) return json(res, 400, { error: 'Invalid game record.' });
      const result = await pool.query(`INSERT INTO web_game_records(user_id,grid_size,max_tile,score,steps,duration_ms) VALUES($1,$2,$3,$4,$5,$6) RETURNING id,completed_at AS "completedAt"`, [user.id, gridSize, maxTile(data.board), data.score, data.steps, data.durationMs]);
      return json(res, 201, { ok: true, record: result.rows[0] });
    }
    if (req.method === 'GET' && /^\/api\/records\/me\/(4|6|8)$/.test(url.pathname)) {
      const gridSize = Number(url.pathname.split('/').pop());
      const result = await pool.query(`SELECT max_tile AS "maxTile",score,steps,duration_ms AS "durationMs",completed_at AS "completedAt" FROM web_game_records WHERE user_id=$1 AND grid_size=$2 ORDER BY completed_at DESC`, [user.id, gridSize]);
      return json(res, 200, result.rows);
    }
    return json(res, 404, { error: 'Not found.' });
  } catch (error) {
    if (error.code === '23505') return json(res, 409, { error: 'Username already exists.' });
    console.error(error);
    return json(res, 500, { error: 'Server error.' });
  }
});

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required, for example: postgresql://user:password@host:5432/game2048');
await initSchema();
server.listen(port, () => console.log(`2048 API listening on port ${port}`));
