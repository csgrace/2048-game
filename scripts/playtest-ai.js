/* ====================================================================
   playtest-ai.js — Node.js AI playtest runner for 2048-game.
   Loads trained weights from js/ai-weights.json, runs N self-play games
   using expectimax + NN evaluation, writes progress to js/ai-playtest-progress.json
   every batch-size games.

   Usage:
     node scripts/playtest-ai.js [--games 20] [--batch 5] [--output js/ai-playtest-progress.json]

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
try {
  var raw = fs.readFileSync(weightsPath, 'utf8');
  weights = JSON.parse(raw);
  console.log('Loaded weights: ' + (weights.l1W ? weights.l1W.length : 0) + ' params, v' + (weights.version || 0));
} catch (e) {
  console.warn('No weights file found (' + e.message + '), running with heuristic only.');
}

/* ---------- build the value network ---------- */
var net = new AIBrain.ValueNet();
if (weights && weights.l1W && weights.l1W.length > 100) {
  net.importWeights(weights);
}

/* ---------- Game logic (same as train-ai.js & browser) ---------- */
function slide(values) {
  var tiles = values.filter(Boolean); var res = []; var gained = 0;
  for (var i = 0; i < tiles.length; i++) {
    if (tiles[i] === tiles[i + 1]) { var v = tiles[i] * 2; res.push(v); gained += v; i++; }
    else res.push(tiles[i]);
  }
  while (res.length < 4) res.push(0);
  return { line: res, gained: gained };
}

function move(grid, dir) {
  var next = grid.map(function (r) { return r.slice(); }); var changed = false, gained = 0;
  for (var i = 0; i < 4; i++) {
    var line = dir < 2 ? next[i].slice() : [grid[0][i], grid[1][i], grid[2][i], grid[3][i]];
    if (dir === 1 || dir === 3) line = line.slice().reverse();
    var res = slide(line); line = res.line.slice();
    if (dir === 1 || dir === 3) line = line.slice().reverse();
    var original = dir < 2 ? next[i].slice() : [grid[0][i], grid[1][i], grid[2][i], grid[3][i]];
    if (line.some(function (v, k) { return v !== original[k]; })) changed = true;
    gained += res.gained;
    if (dir < 2) next[i] = line;
    else for (var r = 0; r < 4; r++) next[r][i] = line[r];
  }
  return { next: next, changed: changed, gained: gained };
}

function empty(grid) {
  var e = [];
  for (var r = 0; r < 4; r++) for (var c = 0; c < 4; c++) if (!grid[r][c]) e.push([r, c]);
  return e;
}

function hasMoves(grid) {
  for (var r = 0; r < 4; r++) for (var c = 0; c < 4; c++) {
    if (!grid[r][c]) return true;
    if (c < 3 && grid[r][c] === grid[r][c + 1]) return true;
    if (r < 3 && grid[r][c] === grid[r + 1][c]) return true;
  }
  return false;
}

function initRandom() {
  var g = [[0,0,0,0],[0,0,0,0],[0,0,0,0],[0,0,0,0]];
  var vals = [2, 4];
  for (var k = 0; k < 2; k++) {
    var e = empty(g); var p = e[Math.random() * e.length | 0];
    g[p[0]][p[1]] = vals[k];
  }
  return g;
}

function gridHash(grid) {
  var h = 0;
  for (var r = 0; r < 4; r++) for (var c = 0; c < 4; c++) h = (h * 31 + grid[r][c]) | 0;
  return h;
}

/* ---------- Heuristic evaluation ---------- */
function heuristicValue(grid) {
  var e = empty(grid).length; var smooth = 0, merges = 0, max = 0; var powers = new Set();
  for (var r = 0; r < 4; r++) for (var c = 0; c < 4; c++) {
    var v = grid[r][c]; if (v > max) max = v;
    if (v > 2) powers.add(Math.log2(v) | 0);
    if (!v) continue;
    if (c < 3) { var o = grid[r][c + 1]; if (o) { smooth -= Math.abs(Math.log2(v) - Math.log2(o)); if (v === o) merges++; } }
    if (r < 3) { var o2 = grid[r + 1][c]; if (o2) { smooth -= Math.abs(Math.log2(v) - Math.log2(o2)); if (v === o2) merges++; } }
  }
  var snake = [[16,15,14,13],[9,10,11,12],[8,7,6,5],[1,2,3,4]];
  var structure = 0; for (var r2 = 0; r2 < 4; r2++) for (var c2 = 0; c2 < 4; c2++) structure += (grid[r2][c2] ? Math.log2(grid[r2][c2]) : 0) * snake[r2][c2];
  var corner = max > 0 && Math.max(grid[0][0], grid[0][3], grid[3][0], grid[3][3]) === max ? 1 : 0;
  var frag = powers.size > 0 ? (powers.size - 1) * 40 : 0;
  var emptyBonus = e > 0 ? e * e * 12 : 0;
  return emptyBonus + structure * 5 + Math.log2(max || 1) * 22 + corner * 200 + smooth * 10 + merges * 150 - frag;
}

/* ---------- Neural evaluation (NN only, no heuristic blend for testing) ---------- */
var INPUT_SIZE = AIBrain.INPUT_SIZE;
function neuralEvaluate(grid) {
  var input = AIBrain.encodeBoard(grid, new Float32Array(INPUT_SIZE));
  var raw = net.forward(input);
  return raw * 5000;  // same scaling as browser
}

/* ---------- Expectimax search ---------- */
var DIRECTIONS = [0, 1, 2, 3]; // left, right, up, down

function expectimax(grid, depth, isChance, table) {
  if (depth <= 0) return neuralEvaluate(grid);
  var key = gridHash(grid) + '_' + depth + '_' + (isChance ? 1 : 0);
  var cached = table.get(key);
  if (cached !== undefined) return cached;
  var value;
  if (!isChance) {
    value = -Infinity;
    for (var d = 0; d < DIRECTIONS.length; d++) {
      var result = move(grid, DIRECTIONS[d]);
      if (result.changed) value = Math.max(value, result.gained + expectimax(result.next, depth - 1, true, table));
    }
    if (value === -Infinity) value = -100000;
  } else {
    var empties = empty(grid);
    if (!empties.length) { value = expectimax(grid, depth - 1, false, table); }
    else {
      // sample up to 3 empty cells (keep fast)
      var sample = empties.length > 3 ? empties.filter(function (_, i, arr) { return i % Math.ceil(arr.length / 3) === 0; }).slice(0, 3) : empties;
      var total = 0;
      for (var s = 0; s < sample.length; s++) {
        var r = sample[s][0], c = sample[s][1];
        var t2 = grid.map(function (row) { return row.slice(); }); t2[r][c] = 2;
        var t4 = grid.map(function (row) { return row.slice(); }); t4[r][c] = 4;
        total += 0.9 * expectimax(t2, depth - 1, false, table) + 0.1 * expectimax(t4, depth - 1, false, table);
      }
      value = total / sample.length;
    }
  }
  table.set(key, value);
  return value;
}

/* Iterative deepening move selection */
function selectMove(grid) {
  var table = new Map();
  var bestDir = null;
  // Adaptive depth: shallow when many empties (branching factor high), deeper when few
  var emptiesCount = empty(grid).length;
  var maxDepth = emptiesCount > 8 ? 2 : emptiesCount > 4 ? 3 : 4;
  for (var depth = 1; depth <= maxDepth; depth++) {
    var localBest = null, localScore = -Infinity;
    for (var d = 0; d < DIRECTIONS.length; d++) {
      var result = move(grid, DIRECTIONS[d]);
      if (!result.changed) continue;
      var value = result.gained + expectimax(result.next, depth, true, table);
      if (value > localScore) { localScore = value; localBest = DIRECTIONS[d]; }
    }
    if (localBest !== null) { bestDir = localBest; }
  }
  return bestDir !== null ? bestDir : 0;
}

/* ---------- Run one game ---------- */
function runGame(gameIdx) {
  var grid = initRandom();
  var score = 0, steps = 0, maxTile = 0;
  var startTime = Date.now();

  while (hasMoves(grid)) {
    var dir = selectMove(grid);
    var result = move(grid, dir);
    if (!result.changed) {
      // try any valid move
      for (var d = 0; d < DIRECTIONS.length; d++) {
        var r2 = move(grid, DIRECTIONS[d]);
        if (r2.changed) { result = r2; break; }
      }
    }
    if (!result.changed) break;
    grid = result.next;
    score += result.gained;
    steps++;

    // place random tile
    var empties = empty(grid);
    if (empties.length) {
      var p = empties[Math.random() * empties.length | 0];
      grid[p[0]][p[1]] = Math.random() < 0.9 ? 2 : 4;
    }

    // compute max tile
    maxTile = 0;
    for (var r = 0; r < 4; r++) for (var c = 0; c < 4; c++) if (grid[r][c] > maxTile) maxTile = grid[r][c];
  }

  var duration = Date.now() - startTime;
  var won = maxTile >= 2048;
  return { game: gameIdx, result: won ? 'win' : 'fail', score: score, maxTile: maxTile, steps: steps, duration: duration };
}

/* ---------- Persist progress to file ---------- */
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
    console.log('  ↳ Pushed progress to git (' + allResults.length + '/' + GAMES + ')');
  } catch (e) {
    console.log('  ↳ Git push skipped: ' + (e.message || 'no changes'));
  }
}

/* ---------- Main loop ---------- */
console.log('=== AI Playtest (' + GAMES + ' games, batch=' + BATCH_SIZE + ') ===');
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
console.log('\n=== Done ===');
console.log('Win rate: ' + Math.round(allResults.filter(function(g){return g.result==='win'}).length / allResults.length * 100) + '%');
console.log('Avg score: ' + Math.round(allResults.reduce(function(a,b){return a+b.score},0) / allResults.length));
console.log('Best max tile: ' + Math.max.apply(null, allResults.map(function(g){return g.maxTile})));
