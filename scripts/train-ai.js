/* ====================================================================
   train-ai.js — Node.js version of the 2048 AI trainer.
   Runs the same self-play + TD(λ) training as the browser Web Worker,
   then writes updated weights to js/ai-weights.json.

   Usage:
     node scripts/train-ai.js [--games 200] [--lr 0.002] [--warmup 30]

   This script is designed to run in GitHub Actions CI.
   The core logic is extracted verbatim from ai-trainer-worker.js —
   only the Web Worker communication layer (postMessage / self.onmessage)
   has been replaced with direct function calls and fs.writeFileSync.
   ==================================================================== */

'use strict';

var fs = require('fs');
var path = require('path');

/* ---------- load ai-brain.js (same file the browser uses) ---------- */
// ai-brain.js is an IIFE that does: (function(root){ ... root.AIBrain = {...}; })(typeof self !== 'undefined' ? self : this)
// In Node.js there is no `self`, so it falls back to `this`.
// We use Node's vm module to run it in a context where `this` is our sandbox.
var vm = require('vm');
var brainSrc = fs.readFileSync(path.join(__dirname, '..', 'js', 'ai-brain.js'), 'utf8');
var sandbox = {};
var context = vm.createContext(sandbox);
vm.runInContext(brainSrc, context);
var AIBrain = sandbox.AIBrain;

if (!AIBrain) {
  console.error('Failed to load ai-brain.js: AIBrain not found after evaluation');
  process.exit(1);
}

/* ---------- parse CLI args ---------- */
var argv = process.argv.slice(2);
var GAMES = 200;
var LR = 0.002;
var WARMUP = 30;
for (var i = 0; i < argv.length; i++) {
  if (argv[i] === '--games' && argv[i + 1]) { GAMES = parseInt(argv[++i], 10); }
  if (argv[i] === '--lr' && argv[i + 1]) { LR = parseFloat(argv[++i]); }
  if (argv[i] === '--warmup' && argv[i + 1]) { WARMUP = parseInt(argv[++i], 10); }
}

/* ---------- training state (same as worker) ---------- */
var net = new AIBrain.ValueNet();
var buffer = [];
var bufferMax = 8000;
var netOut = function (input) { return net.forward(input); };
var totalGamesTrained = 0;
var useNNLeaf = false;

/* ---------- load existing weights for incremental training ---------- */
var weightsPath = path.join(__dirname, '..', 'js', 'ai-weights.json');
try {
  var existing = JSON.parse(fs.readFileSync(weightsPath, 'utf8'));
  if (existing && existing.l1W && existing.l1W.length > 100) {
    net.importWeights(existing);
    totalGamesTrained = existing.version || 0;
    useNNLeaf = totalGamesTrained >= WARMUP;
    console.log('Loaded existing weights (v' + totalGamesTrained + '), NN leaf: ' + useNNLeaf);
  } else {
    console.log('No existing weights found, starting fresh training.');
  }
} catch (e) {
  console.log('No existing weights file, starting fresh training.');
}

/* ---------- fix Adam optimiser initial state ----------
   In ai-brain.js, ADAM_B1_T starts at 1, making the bias correction
   denominator (1 - ADAM_B1_T) = 0 on the first applyGradients call,
   which produces NaN. We call adamReset() then adamStep() to advance
   ADAM_B1_T to 0.9 before any training happens.
*/
AIBrain.adamReset();
AIBrain.adamStep();

/* ========================================================================
   Game-logic replicas — copied verbatim from ai-trainer-worker.js
   ======================================================================== */

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

/* ---------- Neural network leaf evaluation ---------- */
function nnEvaluate(grid) {
  if (!useNNLeaf || !net) return heuristicValue(grid);
  var input = AIBrain.encodeBoard(grid);
  var raw = net.forward(input);
  return heuristicValue(grid) * 0.3 + raw * 5000;
}

/* ---------- Expectimax Search ---------- */
function expectimax(grid, depth, isChance, table) {
  if (depth <= 0) return nnEvaluate(grid);
  var key = gridHash(grid) + '_' + depth + '_' + (isChance ? 1 : 0);
  var cached = table.get(key);
  if (cached !== undefined) return cached;

  var value;
  if (!isChance) {
    value = -Infinity;
    for (var d = 0; d < 4; d++) {
      var res = move(grid, d);
      if (res.changed) {
        var v = res.gained + expectimax(res.next, depth - 1, true, table);
        if (v > value) value = v;
      }
    }
    if (value === -Infinity) value = -100000;
  } else {
    var empties = empty(grid);
    if (!empties.length) {
      value = expectimax(grid, depth - 1, false, table);
    } else {
      // Sample at most 2 empty cells to limit branching
      var sample = empties.length > 2 ? [empties[0], empties[empties.length - 1]] : empties;
      var total = 0;
      for (var i = 0; i < sample.length; i++) {
        var p = sample[i];
        var g2 = grid.map(function(r) { return r.slice(); });
        g2[p[0]][p[1]] = 2;
        var g4 = grid.map(function(r) { return r.slice(); });
        g4[p[0]][p[1]] = 4;
        total += 0.9 * expectimax(g2, depth - 1, false, table) + 0.1 * expectimax(g4, depth - 1, false, table);
      }
      value = total / sample.length;
    }
  }
  table.set(key, value);
  return value;
}

/* ---------- Pick best move using Expectimax ---------- */
function pickMoveExpectimax(grid, maxDepth) {
  var table = new Map();
  var best = -1, bestScore = -Infinity;

  for (var d = 0; d < 4; d++) {
    var res = move(grid, d);
    if (!res.changed) continue;
    var score = res.gained + expectimax(res.next, maxDepth, true, table);
    if (score > bestScore) { bestScore = score; best = d; }
  }
  return best;
}

/* ---------- Adaptive depth based on board state ---------- */
function getSearchDepth(grid) {
  var e = empty(grid).length;
  if (e >= 8) return 2;
  if (e >= 4) return 3;
  return 3;  // cap at 3 to avoid exponential blowup
}

/* ---------- Self-play one game with Expectimax ---------- */
function playOneGame() {
  var g = initRandom();
  var traj = new AIBrain.Trajectory();
  var score = 0;
  var maxTile = 0;

  while (true) {
    var h = heuristicValue(g);
    traj.add(g, 0);

    var depth = getSearchDepth(g);
    var dir = pickMoveExpectimax(g, depth);

    if (dir < 0) break;
    var res = move(g, dir);
    g = res.next;
    score += res.gained;

    for (var r = 0; r < 4; r++) for (var c = 0; c < 4; c++) {
      if (g[r][c] > maxTile) maxTile = g[r][c];
    }

    var e = empty(g); if (!e.length) break;
    var p = e[Math.random() * e.length | 0];
    g[p[0]][p[1]] = Math.random() < 0.9 ? 2 : 4;

    traj.rewards[traj.rewards.length - 1] = res.gained / 200 + (heuristicValue(g) - h) / 5000;
    if (!hasMoves(g)) break;
  }
  return { traj: traj, score: score, maxTile: maxTile };
}

/* ---------- Train one mini-batch step ---------- */
function trainStep(lr, batchSize) {
  if (buffer.length < batchSize) return 0;
  var totalLoss = 0;
  for (var i = 0; i < batchSize; i++) {
    var idx = Math.random() * buffer.length | 0;
    var sample = buffer[idx];
    totalLoss += net.trainStep([{ input: sample.input, target: sample.target, weight: 1 }], lr);
  }
  return totalLoss / batchSize;
}

/* ---------- Add trajectory to buffer with TD(λ) targets ---------- */
function learnFromGame() {
  var result = playOneGame();
  var targets = result.traj.computeTargets(0.95, 0.5, netOut);
  for (var i = 0; i < result.traj.positions.length; i++) {
    buffer.push({ input: result.traj.positions[i], target: targets[i] });
    if (buffer.length > bufferMax) buffer.shift();
  }
  return { score: result.score, maxTile: result.maxTile };
}

/* ========================================================================
   Main training loop — same logic as the worker's train command,
   but synchronous and writes results to file instead of postMessage.
   ======================================================================== */

console.log('');
console.log('========================================================');
console.log('  2048 AI Training');
console.log('  Games: ' + GAMES + ' | LR: ' + LR + ' | Warmup: ' + WARMUP);
console.log('  Existing version: v' + totalGamesTrained);
console.log('========================================================');
console.log('');

var startTime = Date.now();
var totalScore = 0;
var bestMaxTile = 0;
var trainingHistory = [];  // array of {game, loss, maxTile, score, avgScore}

for (var g = 0; g < GAMES; g++) {
  var result = learnFromGame();
  totalGamesTrained++;

  // Enable NN leaf evaluation after warmup
  if (!useNNLeaf && totalGamesTrained >= WARMUP) {
    useNNLeaf = true;
    console.log('[NN enabled at game ' + totalGamesTrained + ']');
  }

  // Train 3 mini-batches per game (reduced from 8 for speed)
  var ls = 0;
  for (var s = 0; s < 3; s++) ls += trainStep(LR, 64);
  ls /= 3;

  totalScore += result.score;
  if (result.maxTile > bestMaxTile) bestMaxTile = result.maxTile;

  // Record training data point every 5 games (for visualization)
  if (g % 5 === 0 || g === GAMES - 1) {
    trainingHistory.push({
      game: g + 1,
      loss: parseFloat(ls.toFixed(6)),
      maxTile: result.maxTile,
      score: result.score,
      avgScore: Math.round(totalScore / (g + 1))
    });
  }

  // Log progress every 20 games
  if (g % 20 === 0 || g === GAMES - 1) {
    var elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    var avgScore = (totalScore / (g + 1)).toFixed(0);
    console.log(
      'Game ' + (g + 1) + '/' + GAMES +
      ' | maxTile=' + result.maxTile +
      ' | bestMax=' + bestMaxTile +
      ' | avgScore=' + avgScore +
      ' | loss=' + ls.toFixed(6) +
      ' | ' + elapsed + 's'
    );
  }
}

/* ---------- save weights + training history ---------- */
var weights = net.exportWeights();
weights.version = totalGamesTrained;
weights.description = '2048 AI trained weights - trained ' + totalGamesTrained + ' games via GitHub Actions';
weights.history = trainingHistory;
weights.bestMaxTile = bestMaxTile;
weights.avgScore = Math.round(totalScore / GAMES);
weights.trainTime = ((Date.now() - startTime) / 1000).toFixed(1) + 's';

fs.writeFileSync(weightsPath, JSON.stringify(weights, null, 2));

var totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
console.log('');
console.log('========================================================');
console.log('  Training complete!');
console.log('  Total games trained: ' + totalGamesTrained);
console.log('  Best max tile: ' + bestMaxTile);
console.log('  Average score: ' + (totalScore / GAMES).toFixed(0));
console.log('  Time: ' + totalTime + 's');
console.log('  Weights saved to: js/ai-weights.json');
console.log('========================================================');
