#!/usr/bin/env node
const SEARCH_DEPTH = 4;
const TEST_GAMES = 20;

const SLIDE_TABLES = (function() {
  const tables = [null, null, null, null];
  for (let d = 0; d < 4; d++) {
    const table = new Map();
    for (let key = 0; key < 65536; key++) {
      const values = [key & 0xF, (key >> 4) & 0xF, (key >> 8) & 0xF, (key >> 12) & 0xF];
      const ordered = d === 1 || d === 3 ? [values[3], values[2], values[1], values[0]] : values.slice();
      const tiles = ordered.filter(v => v > 0);
      const result = []; let gained = 0;
      for (let i = 0; i < tiles.length; i++) {
        if (i + 1 < tiles.length && tiles[i] === tiles[i + 1]) { const v = tiles[i] + 1; result.push(v); gained += (1 << v); i++; }
        else result.push(tiles[i]);
      }
      while (result.length < 4) result.push(0);
      const finalOrder = d === 1 || d === 3 ? [result[3], result[2], result[1], result[0]] : result;
      const encoded = finalOrder[0] | (finalOrder[1] << 4) | (finalOrder[2] << 8) | (finalOrder[3] << 12);
      const changed = values.join(',') !== finalOrder.join(',');
      table.set(key, { encoded, gained, changed });
    }
    tables[d] = table;
  }
  return tables;
})();

function tileEncode(v) { return v > 0 ? Math.min(Math.log2(v) | 0, 15) : 0; }
function tileDecode(e) { return e > 0 ? (1 << e) : 0; }

function moveFast(grid, direction) {
  const table = SLIDE_TABLES[direction];
  const next = [[0,0,0,0],[0,0,0,0],[0,0,0,0],[0,0,0,0]];
  let changed = false, gained = 0;
  for (let idx = 0; idx < 4; idx++) {
    let key;
    if (direction === 0) key = tileEncode(grid[0][idx]) | (tileEncode(grid[1][idx]) << 4) | (tileEncode(grid[2][idx]) << 8) | (tileEncode(grid[3][idx]) << 12);
    else if (direction === 2) key = tileEncode(grid[3][idx]) | (tileEncode(grid[2][idx]) << 4) | (tileEncode(grid[1][idx]) << 8) | (tileEncode(grid[0][idx]) << 12);
    else if (direction === 3) key = tileEncode(grid[idx][0]) | (tileEncode(grid[idx][1]) << 4) | (tileEncode(grid[idx][2]) << 8) | (tileEncode(grid[idx][3]) << 12);
    else key = tileEncode(grid[idx][3]) | (tileEncode(grid[idx][2]) << 4) | (tileEncode(grid[idx][1]) << 8) | (tileEncode(grid[idx][0]) << 12);
    const result = table.get(key);
    if (result.changed) changed = true;
    gained += result.gained;
    const vals = [result.encoded & 0xF, (result.encoded >> 4) & 0xF, (result.encoded >> 8) & 0xF, (result.encoded >> 12) & 0xF];
    if (direction === 0) for (let r = 0; r < 4; r++) next[r][idx] = tileDecode(vals[r]);
    else if (direction === 2) for (let r = 0; r < 4; r++) next[3 - r][idx] = tileDecode(vals[r]);
    else if (direction === 3) for (let c = 0; c < 4; c++) next[idx][c] = tileDecode(vals[c]);
    else for (let c = 0; c < 4; c++) next[idx][3 - c] = tileDecode(vals[c]);
  }
  return { board: next, changed, gained };
}

function emptyCells(grid) { const c = []; for (let r = 0; r < 4; r++) for (let cc = 0; cc < 4; cc++) if (!grid[r][cc]) c.push([r, cc]); return c; }
function hasMoves(b) { for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) { if (!b[r][c]) return true; if (c < 3 && b[r][c] === b[r][c + 1]) return true; if (r < 3 && b[r][c] === b[r + 1][c]) return true; } return false; }
function addTile(b, rng) { const cells = emptyCells(b); if (!cells.length) return; const [r, c] = cells[Math.floor(rng() * cells.length)]; b[r][c] = rng() < 0.9 ? 2 : 4; }
function rng(seed) { let s = seed | 0; return function() { s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function initBoard(r) { const b = [[0,0,0,0],[0,0,0,0],[0,0,0,0],[0,0,0,0]]; addTile(b, r); addTile(b, r); return b; }
function clone(b) { return [b[0].slice(), b[1].slice(), b[2].slice(), b[3].slice()]; }

const WEIGHT_PATTERNS = [
  [[15,14,13,12],[8,9,10,11],[7,6,5,4],[0,1,2,3]],
  [[10,8,7,5],[8,6,4,3],[7,4,2,1],[5,3,1,0]],
  [[12,9,6,3],[9,6,3,0],[6,3,0,0],[3,0,0,0]],
];

function evaluate(grid, w) {
  const emptyCount = emptyCells(grid).length;
  let max = 0;
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) max = Math.max(max, grid[r][c]);
  let structureScore = 0;
  for (const pattern of WEIGHT_PATTERNS) {
    let s = 0;
    for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) s += grid[r][c] * pattern[r][c];
    structureScore += s;
  }
  structureScore /= WEIGHT_PATTERNS.length;
  let smoothness = 0;
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) {
    const v = grid[r][c]; if (v === 0) continue; const logV = Math.log2(v);
    if (c < 3 && grid[r][c + 1]) smoothness -= Math.abs(logV - Math.log2(grid[r][c + 1]));
    if (r < 3 && grid[r + 1][c]) smoothness -= Math.abs(logV - Math.log2(grid[r + 1][c]));
  }
  let mergeCount = 0;
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) {
    const v = grid[r][c]; if (v === 0) continue;
    if (c < 3 && v === grid[r][c + 1]) mergeCount++;
    if (r < 3 && v === grid[r + 1][c]) mergeCount++;
  }
  let cornerBonus = 0;
  if (max > 0) {
    const corners = [grid[0][0], grid[0][3], grid[3][0], grid[3][3]];
    if (Math.max(...corners) === max) cornerBonus = w.corner * max;
  }
  const emptyBonus = emptyCount === 0 ? 0 : Math.pow(emptyCount, 1.5) * w.empty;
  return structureScore * w.structure + emptyBonus + cornerBonus + w.smoothness * smoothness + mergeCount * w.merges + Math.log2(max || 1) * w.maxTile;
}

function expectimax(grid, depth, isChance, weights) {
  if (depth <= 0) return evaluate(grid, weights);
  if (!isChance) {
    let best = -Infinity;
    for (let d = 0; d < 4; d++) { const r = moveFast(grid, d); if (!r.changed) continue; const v = r.gained + expectimax(r.board, depth - 1, true, weights); if (v > best) best = v; }
    return best === -Infinity ? -100000 : best;
  } else {
    const cells = emptyCells(grid);
    if (!cells.length) return expectimax(grid, depth - 1, false, weights);
    let total = 0; const n = cells.length <= 4 ? cells.length : 4; const step = Math.floor(cells.length / n);
    for (let i = 0; i < n; i++) { const [r, c] = cells[i * step]; const t2 = clone(grid); t2[r][c] = 2; const t4 = clone(grid); t4[r][c] = 4; total += 0.9 * expectimax(t2, depth - 1, false, weights) + 0.1 * expectimax(t4, depth - 1, false, weights); }
    return total / n;
  }
}

function bestMove(grid, depth, weights) {
  let bestDir = null, bestScore = -Infinity;
  for (let d = 0; d < 4; d++) { const r = moveFast(grid, d); if (!r.changed) continue; const v = r.gained + expectimax(r.board, depth, true, weights); if (v > bestScore) { bestScore = v; bestDir = d; } }
  return bestDir;
}

function testGame(seed, depth, weights) {
  const r = rng(seed); const board = initBoard(r); let moves = 0;
  while (hasMoves(board) && moves < 3000) { const dir = bestMove(board, depth, weights); if (dir === null) break; const result = moveFast(board, dir); board[0] = result.board[0]; board[1] = result.board[1]; board[2] = result.board[2]; board[3] = result.board[3]; addTile(board, r); moves++; }
  return Math.max(...board.flat()) >= 2048;
}

const BASE = { structure: 2.0, empty: 50, corner: 100, smoothness: 8, merges: 60, maxTile: 30 };

const testCases = [
  { name: 'BASE', weights: {...BASE} },
  { name: 'HIGH_CORNER', weights: {...BASE, corner: 200} },
  { name: 'HIGH_CORNER2', weights: {...BASE, corner: 300} },
  { name: 'LOW_EMPTY', weights: {...BASE, empty: 30} },
  { name: 'LOW_EMPTY2', weights: {...BASE, empty: 20} },
  { name: 'HIGH_MERGES', weights: {...BASE, merges: 100} },
  { name: 'HIGH_MERGES2', weights: {...BASE, merges: 150} },
  { name: 'COMBO1', weights: {...BASE, corner: 200, empty: 30, merges: 100} },
  { name: 'COMBO2', weights: {...BASE, corner: 150, empty: 40, merges: 80} },
  { name: 'COMBO3', weights: {...BASE, corner: 250, empty: 25, smoothness: 12} },
  { name: 'COMBO4', weights: {structure: 1.5, empty: 40, corner: 200, smoothness: 10, merges: 80, maxTile: 40} },
  { name: 'COMBO5', weights: {structure: 2.5, empty: 60, corner: 150, smoothness: 6, merges: 70, maxTile: 25} },
];

console.log('=== Targeted Weight Testing ===\n');
console.log('Depth: ' + SEARCH_DEPTH + ', Games: ' + TEST_GAMES + '\n');

let best = { name: '', winRate: 0, weights: null };

for (const tc of testCases) {
  let wins = 0;
  const start = Date.now();
  for (let g = 0; g < TEST_GAMES; g++) {
    if (testGame(500000 + g, SEARCH_DEPTH, tc.weights)) wins++;
  }
  const rate = wins / TEST_GAMES;
  const time = (Date.now() - start) / TEST_GAMES;
  const marker = rate > best.winRate ? ' <- BEST' : '';
  console.log(tc.name + ': ' + (rate*100).toFixed(1) + '% (' + wins + '/' + TEST_GAMES + ') | ' + time.toFixed(0) + 'ms' + marker);
  if (rate > best.winRate) best = { name: tc.name, winRate: rate, weights: tc.weights };
}

console.log('\n=== BEST: ' + best.name + ' ===');
console.log('Win rate: ' + (best.winRate*100).toFixed(1) + '%');
console.log('Weights: ' + JSON.stringify(best.weights));

const fs = require('fs');
fs.writeFileSync('js/ai-best-weights.json', JSON.stringify({name: best.name, weights: best.weights, winRate: best.winRate, searchDepth: SEARCH_DEPTH}, null, 2));

console.log('\n--- Validation (50 games) ---');
let valWins = 0;
for (let i = 0; i < 50; i++) if (testGame(400000 + i, SEARCH_DEPTH, best.weights)) valWins++;
console.log('Validation: ' + (valWins/50*100).toFixed(1) + '% (' + valWins + '/50)');

if (valWins >= 45) console.log('90%+ TARGET ACHIEVED!');
else if (valWins >= 40) console.log('80%+ - Very good!');
else console.log('Best: ' + valWins + '/50');
