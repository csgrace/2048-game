/* ====================================================================
   playtest-ai.js — Node.js AI playtest runner for 2048-game.
   Loads trained weights from js/ai-weights.json, runs N self-play games
   using the SAME AI logic as the browser's AI Auto Play (aiBestMove),
   writes progress to js/ai-playtest-progress.json after every game,
   and pushes to git every BATCH_SIZE games.

   Usage:
     node scripts/playtest-ai.js [--games=20] [--batch=5] [--output=js/ai-playtest-progress.json]

   This is designed to run in GitHub Actions CI.
   ==================================================================== */

'use strict';

var fs = require('fs');
var path = require('path');

/* ---------- CLI args ---------- */
var args = {};
process.argv.slice(2).forEach(function (a) {
  var m = a.match(/^--(\w+)(?:=(.+))?$/);
  if (m) args[m[1]] = m[2] === undefined ? true : m[2];
});
var GAMES = parseInt(args.games || '20', 10);
var BATCH_SIZE = parseInt(args.batch || '5', 10);
var OUTPUT_FILE = args.output || 'js/ai-playtest-progress.json';

/* ---------- load ai-brain.js ---------- */
var vm = require('vm');
var brainSrc = fs.readFileSync(path.join(__dirname, '..', 'js', 'ai-brain.js'), 'utf8');
var brainSandbox = {};
vm.createContext(brainSandbox);
vm.runInContext(brainSrc, brainSandbox);
var AIBrain = brainSandbox.AIBrain;
if (!AIBrain) { console.error('Failed to load ai-brain.js'); process.exit(1); }

/* ---------- load weights ---------- */
var weightsPath = path.join(__dirname, '..', 'js', 'ai-weights.json');
var weights = null;
var aiTrainGames = 0;
try {
  var raw = fs.readFileSync(weightsPath, 'utf8');
  weights = JSON.parse(raw);
  aiTrainGames = weights.version || 0;
  console.log('Loaded weights: ' + (weights.l1W ? weights.l1W.length : 0) + ' params, v' + aiTrainGames);
} catch (e) {
  console.warn('No weights file found (' + e.message + '), running with heuristic only.');
}

/* ---------- build the value network ---------- */
var aiNet = new AIBrain.ValueNet();
var aiUseNN = false;
if (weights && weights.l1W && weights.l1W.length > 100) {
  aiNet.importWeights(weights);
  aiUseNN = aiTrainGames > 30; // match training threshold (WARMUP=30)
}
var INPUT_SIZE = AIBrain.INPUT_SIZE;

/* ========================================================================
   Game logic — exact copy from browser index.html
   ======================================================================== */

var AI_DIRECTIONS = ['up', 'left', 'down', 'right'];
var AI_BUDGET_MS = 60;  // same time budget as browser

function aiClone(grid) { return grid.map(function (row) { return row.slice(); }); }

function aiSlide(values) {
  var tiles = values.filter(Boolean);
  var result = []; var gained = 0;
  for (var i = 0; i < tiles.length; i++) {
    if (tiles[i] === tiles[i + 1]) { var v = tiles[i] * 2; result.push(v); gained += v; i++; }
    else result.push(tiles[i]);
  }
  while (result.length < 4) result.push(0);
  return { line: result, gained: gained };
}

function aiMoveBoard(grid, direction) {
  var next = aiClone(grid); var changed = false, gained = 0;
  for (var index = 0; index < 4; index++) {
    var line = direction === 'left' || direction === 'right' ? next[index].slice() : next.map(function (row) { return row[index]; });
    if (direction === 'right' || direction === 'down') line.reverse();
    var res = aiSlide(line); line = res.line;
    if (direction === 'right' || direction === 'down') line.reverse();
    var original = direction === 'left' || direction === 'right' ? next[index].slice() : next.map(function (row) { return row[index]; });
    if (line.some(function (v, i) { return v !== original[i]; })) changed = true;
    gained += res.gained;
    if (direction === 'left' || direction === 'right') next[index] = line;
    else for (var row = 0; row < 4; row++) next[row][index] = line[row];
  }
  return { board: next, changed: changed, gained: gained };
}

function aiEmptyCells(grid) {
  var cells = [];
  for (var row = 0; row < 4; row++) for (var col = 0; col < 4; col++) if (!grid[row][col]) cells.push([row, col]);
  return cells;
}

function aiGridHash(grid) {
  var h = 0;
  for (var r = 0; r < 4; r++) for (var c = 0; c < 4; c++) h = (h * 31 + grid[r][c]) | 0;
  return h;
}

/* ---------- Heuristic evaluation (exact copy from browser) ---------- */
function aiEvaluate(grid) {
  var emptyCnt = aiEmptyCells(grid).length;
  var smooth = 0, merges = 0, frag = 0, max = 0;
  var powers = new Set();
  for (var row = 0; row < 4; row++) for (var col = 0; col < 4; col++) {
    var value = grid[row][col]; max = Math.max(max, value);
    if (!value) continue;
    if (value > 2) powers.add(Math.log2(value));
    if (col < 3) { var o = grid[row][col + 1]; if (o) { smooth -= Math.abs(Math.log2(value) - Math.log2(o)); if (value === o) merges++; } }
    if (row < 3) { var o2 = grid[row + 1][col]; if (o2) { smooth -= Math.abs(Math.log2(value) - Math.log2(o2)); if (value === o2) merges++; } }
  }
  frag = powers.size > 0 ? (powers.size - 1) * 40 : 0;
  var snake = [[16, 15, 14, 13], [9, 10, 11, 12], [8, 7, 6, 5], [1, 2, 3, 4]];
  var structure = 0;
  for (var r2 = 0; r2 < 4; r2++) for (var c2 = 0; c2 < 4; c2++) structure += (grid[r2][c2] ? Math.log2(grid[r2][c2]) : 0) * snake[r2][c2];
  var corner = max > 0 && Math.max(grid[0][0], grid[0][3], grid[3][0], grid[3][3]) === max ? 1 : 0;
  var emptyBonus = emptyCnt > 0 ? emptyCnt * emptyCnt * 12 : 0;
  return emptyBonus + structure * 5 + Math.log2(max || 1) * 22 + corner * 200 + smooth * 10 + merges * 150 - frag;
}

/* ---------- Neural evaluation with blend (exact copy from browser) ---------- */
function aiNeuralEvaluate(grid) {
  if (!aiUseNN || !aiNet) return aiEvaluate(grid);
  var input = AIBrain.encodeBoard(grid, new Float32Array(INPUT_SIZE));
  var raw = aiNet.forward(input);
  var nnWeight = Math.min(0.8, aiTrainGames / 300);
  return aiEvaluate(grid) * (1 - nnWeight) + raw * 5000 * nnWeight;
}

/* ---------- Expectimax with neural leaf (exact copy from browser) ---------- */
function aiExpectimax(grid, depth, isChance, table) {
  if (depth <= 0) return aiNeuralEvaluate(grid);
  var key = aiGridHash(grid) + '_' + depth + '_' + (isChance ? 1 : 0);
  var cached = table.get(key);
  if (cached !== undefined) return cached;
  var value;
  if (!isChance) {
    value = -Infinity;
    for (var i = 0; i < AI_DIRECTIONS.length; i++) {
      var result = aiMoveBoard(grid, AI_DIRECTIONS[i]);
      if (result.changed) value = Math.max(value, result.gained + aiExpectimax(result.board, depth - 1, true, table));
    }
    if (value === -Infinity) value = -100000;
  } else {
    var empty = aiEmptyCells(grid);
    if (!empty.length) { value = aiExpectimax(grid, depth - 1, false, table); }
    else {
      var sample = empty.length > 4 ? empty.filter(function (_, i, arr) { return i % Math.ceil(arr.length / 4) === 0; }) : empty;
      var total = 0;
      for (var s = 0; s < sample.length; s++) {
        var r = sample[s][0], c = sample[s][1];
        var t2 = aiClone(grid); t2[r][c] = 2;
        var t4 = aiClone(grid); t4[r][c] = 4;
        total += 0.9 * aiExpectimax(t2, depth - 1, false, table) + 0.1 * aiExpectimax(t4, depth - 1, false, table);
      }
      value = total / sample.length;
    }
  }
  table.set(key, value);
  return value;
}

/* ---------- Monte Carlo rollout (exact copy from browser) ---------- */
function aiMonteCarlo(grid, move, rounds) {
  var totalGained = 0;
  for (var round = 0; round < rounds; round++) {
    var current = aiMoveBoard(grid, move).board; var gained = 0, steps = 0;
    while (steps < 20) {
      var empties = aiEmptyCells(current); if (!empties.length) break;
      var p = empties[Math.floor(Math.random() * empties.length)];
      current[p[0]][p[1]] = Math.random() < 0.9 ? 2 : 4;
      var moved = false;
      var dirs = AI_DIRECTIONS.slice().sort(function () { return Math.random() - 0.5; });
      for (var d = 0; d < dirs.length; d++) {
        var res = aiMoveBoard(current, dirs[d]);
        if (res.changed) { gained += res.gained; current = res.board; moved = true; break; }
      }
      if (!moved) break;
      steps++;
    }
    totalGained += gained;
  }
  return totalGained / rounds;
}

/* ---------- Top-level move selection (exact copy from browser aiBestMove) ---------- */
function aiBestMove(grid) {
  var table = new Map();
  var start = Date.now();
  var bestDirection = null, depthReached = 0;
  for (var targetDepth = 2; targetDepth <= 6; targetDepth++) {
    var localBest = null, localScore = -Infinity, completed = true;
    for (var i = 0; i < AI_DIRECTIONS.length; i++) {
      var result = aiMoveBoard(grid, AI_DIRECTIONS[i]);
      if (!result.changed) continue;
      var value = result.gained + aiExpectimax(result.board, targetDepth, true, table);
      if (value > localScore) { localScore = value; localBest = AI_DIRECTIONS[i]; }
    }
    if (Date.now() - start > AI_BUDGET_MS) { completed = false; }
    if (completed && localBest) { bestDirection = localBest; depthReached = targetDepth; }
    if (!completed) break;
  }
  // Monte Carlo tie-break / validation between the two best expectimax choices
  var candidates = [];
  for (var j = 0; j < AI_DIRECTIONS.length; j++) {
    var res2 = aiMoveBoard(grid, AI_DIRECTIONS[j]);
    if (!res2.changed) continue;
    candidates.push({ direction: AI_DIRECTIONS[j], expectimax: res2.gained + aiExpectimax(res2.board, 2, true, new Map()) });
  }
  candidates.sort(function (a, b) { return b.expectimax - a.expectimax; });
  if (candidates.length) {
    var top1 = candidates[0];
    var top2 = candidates.length > 1 ? candidates[1] : null;
    var probeRounds = 8;
    var mc1 = aiMonteCarlo(grid, top1.direction, probeRounds);
    var mc2 = top2 ? aiMonteCarlo(grid, top2.direction, probeRounds) : -1;
    if (top2 && mc2 > mc1 * 1.15) bestDirection = top2.direction;
    else bestDirection = top1.direction;
  }
  return bestDirection;
}

/* ========================================================================
   Game loop — same as browser: init → aiBestMove → move → addRandom → repeat
   ======================================================================== */

function hasMoves(grid) {
  for (var r = 0; r < 4; r++) for (var c = 0; c < 4; c++) {
    if (!grid[r][c]) return true;
    if (c < 3 && grid[r][c] === grid[r][c + 1]) return true;
    if (r < 3 && grid[r][c] === grid[r + 1][c]) return true;
  }
  return false;
}

function initRandom() {
  var g = [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]];
  var vals = [2, 4];
  for (var k = 0; k < 2; k++) {
    var e = aiEmptyCells(g); var p = e[Math.floor(Math.random() * e.length)];
    g[p[0]][p[1]] = vals[k];
  }
  return g;
}

function maxTile(grid) {
  var m = 0;
  for (var r = 0; r < 4; r++) for (var c = 0; c < 4; c++) if (grid[r][c] > m) m = grid[r][c];
  return m;
}

/* ---------- Run one game (mirrors browser AI Auto Play) ---------- */
function runGame(gameIdx) {
  var grid = initRandom();
  var score = 0, steps = 0;
  var startTime = Date.now();

  while (hasMoves(grid)) {
    var direction = aiBestMove(grid);
    if (!direction) break;
    var result = aiMoveBoard(grid, direction);
    if (!result.changed) break;
    grid = result.board;
    score += result.gained;
    steps++;

    // place random tile (same as browser: 90% 2, 10% 4)
    var empties = aiEmptyCells(grid);
    if (empties.length) {
      var p = empties[Math.floor(Math.random() * empties.length)];
      grid[p[0]][p[1]] = Math.random() < 0.9 ? 2 : 4;
    }
  }

  var duration = Date.now() - startTime;
  var mt = maxTile(grid);
  var won = mt >= 2048;
  return { game: gameIdx, result: won ? 'win' : 'fail', score: score, maxTile: mt, steps: steps, duration: duration };
}

/* ========================================================================
   Progress persistence + git push
   ======================================================================== */

function persistProgress(allResults, active) {
  var totalGames = allResults.length;
  var wins = allResults.filter(function (g) { return g.result === 'win'; }).length;
  var avgScore = totalGames > 0 ? Math.round(allResults.reduce(function (a, b) { return a + b.score; }, 0) / totalGames) : 0;
  var bestMax = totalGames > 0 ? Math.max.apply(null, allResults.map(function (g) { return g.maxTile; })) : 0;
  var totalTime = allResults.reduce(function (a, b) { return a + b.duration; }, 0);

  var data = {
    active: active,
    timestamp: new Date().toISOString(),
    totalGames: GAMES,
    completedGames: totalGames,
    wins: wins,
    fails: totalGames - wins,
    winRate: totalGames > 0 ? Math.round(wins / totalGames * 100) : 0,
    avgScore: avgScore,
    bestMaxTile: bestMax,
    totalDurationMs: totalTime,
    results: allResults
  };

  try {
    fs.writeFileSync(path.join(__dirname, '..', OUTPUT_FILE), JSON.stringify(data, null, 2));
    console.log('Progress saved: ' + totalGames + '/' + GAMES + ' games, ' + wins + 'W/' + (totalGames - wins) + 'L, best=' + bestMax);
  } catch (e) {
    console.error('Failed to write progress: ' + e.message);
  }
}

/* ---------- Push progress to git so frontend can poll ---------- */
var allResults = [];
var execSync = require('child_process').execSync;
function gitPushProgress() {
  try {
    execSync('git add ' + OUTPUT_FILE, { stdio: 'ignore' });
    execSync('git commit -m "chore(ai): playtest progress ' + allResults.length + '/' + GAMES + ' [skip ci]"', { stdio: 'ignore' });
    execSync('git push', { stdio: 'ignore' });
    console.log('  Pushed progress to git (' + allResults.length + '/' + GAMES + ')');
  } catch (e) {
    console.log('  Git push skipped: ' + (e.message || 'no changes'));
  }
}

/* ========================================================================
   Main loop
   ======================================================================== */
console.log('=== AI Playtest (' + GAMES + ' games, batch=' + BATCH_SIZE + ') ===');
console.log('AI mode: ' + (aiUseNN ? 'NN blend (v' + aiTrainGames + ', nnWeight=' + Math.min(0.8, aiTrainGames / 300).toFixed(3) + ')' : 'heuristic only'));
persistProgress(allResults, true);

for (var i = 1; i <= GAMES; i++) {
  var result = runGame(i);
  allResults.push(result);
  console.log('Game ' + i + '/' + GAMES + ': ' + (result.result === 'win' ? 'WIN' : 'LOSS') + ' score=' + result.score + ' max=' + result.maxTile + ' steps=' + result.steps + ' time=' + result.duration + 'ms');

  // Write progress after every game so the frontend can see incremental results
  persistProgress(allResults, true);

  // Push to git every BATCH_SIZE games so frontend can poll
  if (i % BATCH_SIZE === 0) {
    gitPushProgress();
  }
}

// Final
persistProgress(allResults, false);
gitPushProgress();
console.log('\n=== Done ===');
console.log('Win rate: ' + Math.round(allResults.filter(function (g) { return g.result === 'win'; }).length / allResults.length * 100) + '%');
console.log('Avg score: ' + Math.round(allResults.reduce(function (a, b) { return a + b.score; }, 0) / allResults.length));
console.log('Best max tile: ' + Math.max.apply(null, allResults.map(function (g) { return g.maxTile; })));
