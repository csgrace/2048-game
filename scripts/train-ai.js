/* ====================================================================
   train-ai.js — Node.js version of the 2048 AI trainer.
   Runs the same self-play + TD(λ) training as the browser Web Worker,
   then writes updated weights to js/ai-weights.json.

   Usage (CLI):
     node scripts/train-ai.js [--games 100] [--lr 0.002] [--warmup 30]

   Usage (Module — used by server.js for Render cloud training):
     var train = require('./scripts/train-ai.js');
     train.run({ games: 100, onProgress: function(data) {...}, onComplete: function(weights) {...} });

   This script is designed to run in GitHub Actions CI and Render cloud.
   The core logic is extracted verbatim from ai-trainer-worker.js —
   only the Web Worker communication layer (postMessage / self.onmessage)
   has been replaced with direct function calls and fs.writeFileSync.
   ==================================================================== */

'use strict';

var fs = require('fs');
var path = require('path');

/* ---------- load ai-brain.js (same file the browser uses) ---------- */
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

/* ---------- Game-logic replicas — identical to browser aiBestMove ---------- */

var AI_DIRECTIONS = ['up', 'left', 'down', 'right'];
var AI_BUDGET_MS = 60; // same time budget as browser/playtest

function aiClone(grid) { return grid.map(function (r) { return r.slice(); }); }

function slide(values) {
  var tiles = values.filter(Boolean); var res = []; var gained = 0;
  for (var i = 0; i < tiles.length; i++) {
    if (tiles[i] === tiles[i + 1]) { var v = tiles[i] * 2; res.push(v); gained += v; i++; }
    else res.push(tiles[i]);
  }
  while (res.length < 4) res.push(0);
  return { line: res, gained: gained };
}

/* aiMoveBoard — identical to browser/playtest version */
function aiMoveBoard(grid, direction) {
  var next = aiClone(grid); var changed = false, gained = 0;
  for (var index = 0; index < 4; index++) {
    var line = direction === 'left' || direction === 'right' ? next[index].slice() : next.map(function (r) { return r[index]; });
    if (direction === 'right' || direction === 'down') line.reverse();
    var res = slide(line); line = res.line;
    if (direction === 'right' || direction === 'down') line.reverse();
    var original = direction === 'left' || direction === 'right' ? next[index].slice() : next.map(function (r) { return r[index]; });
    if (line.some(function (v, i) { return v !== original[i]; })) changed = true;
    gained += res.gained;
    if (direction === 'left' || direction === 'right') next[index] = line;
    else for (var row = 0; row < 4; row++) next[row][index] = line[row];
  }
  return { board: next, changed: changed, gained: gained };
}

/* move() wraps aiMoveBoard for backward compat (dir is 0-3 integer) */
function move(grid, dir) {
  var dirName = AI_DIRECTIONS[dir]; // 0=up, 1=left, 2=down, 3=right
  var res = aiMoveBoard(grid, dirName);
  return { next: res.board, changed: res.changed, gained: res.gained };
}

function empty(grid) {
  var e = [];
  for (var r = 0; r < 4; r++) for (var c = 0; c < 4; c++) if (!grid[r][c]) e.push([r, c]);
  return e;
}
// alias for playtest code that calls aiEmptyCells
function aiEmptyCells(grid) { return empty(grid); }

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
function aiGridHash(grid) { return gridHash(grid); }

/* ---------- Heuristic evaluation — identical to browser aiEvaluate ---------- */
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

/* ========================================================================
   Core training function — shared by CLI and module modes.
   opts: { games, lr, warmup, onProgress, onComplete, onError, existingWeights }
   ======================================================================== */
function runTraining(opts) {
  var GAMES = opts.games || 100;
  var LR = opts.lr || 0.002;
  var WARMUP = opts.warmup || 30;
  var onProgress = opts.onProgress || function () {};
  var onComplete = opts.onComplete || function () {};
  var onError = opts.onError || function () {};

  /* ---------- training state ---------- */
  var net = new AIBrain.ValueNet();
  var buffer = [];
    var bufferMax = 16000; // larger replay buffer for more training data
  var netOut = function (input) { return net.forward(input); };
  var totalGamesTrained = 0;
  var useNNLeaf = false;

  /* ---------- load existing weights ---------- */
  if (opts.existingWeights && opts.existingWeights.l1W && opts.existingWeights.l1W.length > 100) {
    net.importWeights(opts.existingWeights);
    totalGamesTrained = opts.existingWeights.version || 0;
    useNNLeaf = totalGamesTrained >= WARMUP;
    console.log('Loaded existing weights (v' + totalGamesTrained + '), NN leaf: ' + useNNLeaf);
  }

  /* ---------- fix Adam optimiser ---------- */
  AIBrain.adamReset();
  AIBrain.adamStep();

  /* ---------- Neural network leaf evaluation — identical to browser aiNeuralEvaluate ---------- */
  function nnEvaluate(grid) {
    if (!useNNLeaf || !net) return heuristicValue(grid);
    var input = AIBrain.encodeBoard(grid);
    var raw = net.forward(input);
    var nnWeight = Math.min(0.8, totalGamesTrained / 300);
    return heuristicValue(grid) * (1 - nnWeight) + raw * 5000 * nnWeight;
  }

  /* ---------- Expectimax Search — identical to browser aiExpectimax ---------- */
  function expectimax(grid, depth, isChance, table) {
    if (depth <= 0) return nnEvaluate(grid);
    var key = gridHash(grid) + '_' + depth + '_' + (isChance ? 1 : 0);
    var cached = table.get(key);
    if (cached !== undefined) return cached;
    var value;
    if (!isChance) {
      value = -Infinity;
      for (var i = 0; i < AI_DIRECTIONS.length; i++) {
        var result = aiMoveBoard(grid, AI_DIRECTIONS[i]);
        if (result.changed) value = Math.max(value, result.gained + expectimax(result.board, depth - 1, true, table));
      }
      if (value === -Infinity) value = -100000;
    } else {
      var empties = empty(grid);
      if (!empties.length) { value = expectimax(grid, depth - 1, false, table); }
      else {
        var sample = empties.length > 4 ? empties.filter(function (_, i, arr) { return i % Math.ceil(arr.length / 4) === 0; }) : empties;
        var total = 0;
        for (var s = 0; s < sample.length; s++) {
          var p = sample[s];
          var t2 = aiClone(grid); t2[p[0]][p[1]] = 2;
          var t4 = aiClone(grid); t4[p[0]][p[1]] = 4;
          total += 0.9 * expectimax(t2, depth - 1, false, table) + 0.1 * expectimax(t4, depth - 1, false, table);
        }
        value = total / sample.length;
      }
    }
    table.set(key, value);
    return value;
  }

  /* ---------- Monte Carlo rollout — identical to browser aiMonteCarlo ---------- */
  function monteCarlo(grid, moveDir, rounds) {
    var totalGained = 0;
    for (var round = 0; round < rounds; round++) {
      var current = aiMoveBoard(grid, moveDir).board; var gained = 0, steps = 0;
      while (steps < 20) {
        var empties = empty(current); if (!empties.length) break;
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

  /* ---------- aiBestMove — IDENTICAL to browser/playtest version ---------- */
  function aiBestMove(grid) {
    var table = new Map();
    var start = Date.now();
    var bestDirection = null;
    for (var targetDepth = 2; targetDepth <= 6; targetDepth++) {
      var localBest = null, localScore = -Infinity, completed = true;
      for (var i = 0; i < AI_DIRECTIONS.length; i++) {
        var result = aiMoveBoard(grid, AI_DIRECTIONS[i]);
        if (!result.changed) continue;
        var value = result.gained + expectimax(result.board, targetDepth, true, table);
        if (value > localScore) { localScore = value; localBest = AI_DIRECTIONS[i]; }
      }
      if (Date.now() - start > AI_BUDGET_MS) { completed = false; }
      if (completed && localBest) { bestDirection = localBest; }
      if (!completed) break;
    }
    // Monte Carlo tie-break / validation
    var candidates = [];
    for (var j = 0; j < AI_DIRECTIONS.length; j++) {
      var res2 = aiMoveBoard(grid, AI_DIRECTIONS[j]);
      if (!res2.changed) continue;
      candidates.push({ direction: AI_DIRECTIONS[j], expectimax: res2.gained + expectimax(res2.board, 2, true, new Map()) });
    }
    candidates.sort(function (a, b) { return b.expectimax - a.expectimax; });
    if (candidates.length) {
      var top1 = candidates[0];
      var top2 = candidates.length > 1 ? candidates[1] : null;
      var probeRounds = 8;
      var mc1 = monteCarlo(grid, top1.direction, probeRounds);
      var mc2 = top2 ? monteCarlo(grid, top2.direction, probeRounds) : -1;
      if (top2 && mc2 > mc1 * 1.15) bestDirection = top2.direction;
      else bestDirection = top1.direction;
    }
    return bestDirection;
  }

  /* ---------- Self-play one game using IDENTICAL aiBestMove as test/browser ---------- */
  function playOneGame() {
    var g = initRandom();
    var traj = new AIBrain.Trajectory();
    var score = 0;
    var maxTile = 0;
    while (true) {
      var h = heuristicValue(g);
      traj.add(g, 0);
      var dir = aiBestMove(g);
      if (!dir) break;
      var res = aiMoveBoard(g, dir);
      if (!res.changed) break;
      g = res.board;
      score += res.gained;
      for (var r = 0; r < 4; r++) for (var c = 0; c < 4; c++) {
        if (g[r][c] > maxTile) maxTile = g[r][c];
      }
      var e = empty(g); if (!e.length) break;
      var p = e[Math.random() * e.length | 0];
      g[p[0]][p[1]] = Math.random() < 0.9 ? 2 : 4;
      // Reward: small step reward + heuristic delta + big bonus for reaching 2048
      var stepReward = res.gained / 200 + (heuristicValue(g) - h) / 5000;
      // Bonus for crossing 2048 threshold (the main goal!)
      if (maxTile >= 2048 && traj.rewards.length > 0) {
        stepReward += 0.5; // big positive reward for reaching 2048
      }
      traj.rewards[traj.rewards.length - 1] = stepReward;
      if (!hasMoves(g)) {
        // Terminal penalty: if we never reached 2048, penalize heavily
        if (maxTile < 2048) {
          traj.rewards[traj.rewards.length - 1] -= 0.3;
        } else {
          traj.rewards[traj.rewards.length - 1] += 0.2; // bonus for surviving past 2048
        }
        break;
      }
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
     Main training loop
     ======================================================================== */
  var startTime = Date.now();
  var totalScore = 0;
  var bestMaxTile = 0;
  var trainingHistory = [];

  console.log('');
  console.log('========================================================');
  console.log('  2048 AI Training');
  console.log('  Games: ' + GAMES + ' | LR: ' + LR + ' | Warmup: ' + WARMUP);
  console.log('  Existing version: v' + totalGamesTrained);
  console.log('========================================================');
  console.log('');

  onProgress({ type: 'start', games: GAMES, version: totalGamesTrained });

  for (var g = 0; g < GAMES; g++) {
    var result = learnFromGame();
    totalGamesTrained++;

    if (!useNNLeaf && totalGamesTrained >= WARMUP) {
      useNNLeaf = true;
      console.log('[NN enabled at game ' + totalGamesTrained + ']');
      onProgress({ type: 'nn_enabled', game: totalGamesTrained });
    }

    var ls = 0;
    for (var s = 0; s < 4; s++) ls += trainStep(LR, 64); // fewer steps per game = faster
    ls /= 4;

    totalScore += result.score;
    if (result.maxTile > bestMaxTile) bestMaxTile = result.maxTile;

    if (g % 5 === 0 || g === GAMES - 1) {
      var dataPoint = {
        game: g + 1,
        total: GAMES,
        loss: parseFloat(ls.toFixed(6)),
        maxTile: result.maxTile,
        score: result.score,
        avgScore: Math.round(totalScore / (g + 1)),
        bestMax: bestMaxTile,
        version: totalGamesTrained
      };
      trainingHistory.push(dataPoint);
      onProgress(Object.assign({ type: 'progress' }, dataPoint, { history: trainingHistory }));
    }

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

  /* ---------- save weights ---------- */
  var weights = net.exportWeights();
  weights.version = totalGamesTrained;
  weights.description = '2048 AI trained weights - trained ' + totalGamesTrained + ' games';
  weights.history = trainingHistory;
  weights.bestMaxTile = bestMaxTile;
  weights.avgScore = Math.round(totalScore / GAMES);
  weights.trainTime = ((Date.now() - startTime) / 1000).toFixed(1) + 's';

  var totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log('');
  console.log('========================================================');
  console.log('  Training complete!');
  console.log('  Total games trained: ' + totalGamesTrained);
  console.log('  Best max tile: ' + bestMaxTile);
  console.log('  Average score: ' + (totalScore / GAMES).toFixed(0));
  console.log('  Time: ' + totalTime + 's');
  console.log('========================================================');

  onComplete(weights);
  return weights;
}

/* ========================================================================
   Module exports — server.js uses run() with callbacks for SSE streaming.
   ======================================================================== */
module.exports = {
  run: runTraining,
  AIBrain: AIBrain
};

/* ========================================================================
   CLI mode — when run directly: `node scripts/train-ai.js --games 100`
   ======================================================================== */
if (require.main === module) {
  var argv = process.argv.slice(2);
  var GAMES = 100;
  var LR = 0.002;
  var WARMUP = 30;
  for (var i = 0; i < argv.length; i++) {
    if (argv[i] === '--games' && argv[i + 1]) { GAMES = parseInt(argv[++i], 10); }
    if (argv[i] === '--lr' && argv[i + 1]) { LR = parseFloat(argv[i + 1]); }
    if (argv[i] === '--warmup' && argv[i + 1]) { WARMUP = parseInt(argv[i + 1], 10); }
  }

  /* Load existing weights from file */
  var weightsPath = path.join(__dirname, '..', 'js', 'ai-weights.json');
  var existingWeights = null;
  try {
    existingWeights = JSON.parse(fs.readFileSync(weightsPath, 'utf8'));
    if (!existingWeights || !existingWeights.l1W || existingWeights.l1W.length < 100) existingWeights = null;
  } catch (e) { /* no file */ }

  var cliStartTime = Date.now();

  runTraining({
    games: GAMES,
    lr: LR,
    warmup: WARMUP,
    existingWeights: existingWeights,
    onProgress: function (data) {
      // Every 20 games, write intermediate progress so frontend can poll
      if (data.type === 'progress' && data.game % 20 === 0) {
        try {
          var progressPath = path.join(__dirname, '..', 'js', 'ai-training-progress.json');
          // Write full training history up to this point
          var progressPayload = {
            active: true,
            game: data.game,
            total: data.total,
            loss: data.loss,
            maxTile: data.maxTile,
            bestMax: data.bestMax,
            avgScore: data.avgScore,
            version: data.version,
            history: data.history || [],
            timestamp: Date.now()
          };
          fs.writeFileSync(progressPath, JSON.stringify(progressPayload, null, 2));
          // Git commit + push the progress file
          var execSync = require('child_process').execSync;
          var repoRoot = path.join(__dirname, '..');
          try {
            execSync('git add js/ai-training-progress.json', { cwd: repoRoot, stdio: 'pipe' });
            execSync('git commit -m "progress: game ' + data.game + '/' + data.total + ' [skip ci]"', { cwd: repoRoot, stdio: 'pipe' });
            execSync('git push', { cwd: repoRoot, stdio: 'pipe' });
            console.log('[Progress committed: game ' + data.game + '/' + data.total + ']');
          } catch (e) {
            // Git commit might fail silently (no changes or network), that's ok
            console.log('[Git push skipped: ' + (e.stderr ? e.stderr.toString().trim() : e.message) + ']');
          }
        } catch (e) {
          console.log('[Progress write error: ' + e.message + ']');
        }
      }
    },
    onComplete: function (weights) {
      fs.writeFileSync(weightsPath, JSON.stringify(weights, null, 2));
      console.log('Weights saved to: js/ai-weights.json');
      // Write final progress file (marks training as done)
      try {
        var progressPath = path.join(__dirname, '..', 'js', 'ai-training-progress.json');
        var finalHistory = weights.history || [];
        fs.writeFileSync(progressPath, JSON.stringify({
          active: false,
          done: true,
          version: weights.version,
          bestMaxTile: weights.bestMaxTile,
          avgScore: weights.avgScore,
          trainTime: weights.trainTime,
          history: finalHistory,
          timestamp: Date.now()
        }, null, 2));
        var execSync = require('child_process').execSync;
        var repoRoot = path.join(__dirname, '..');
        try {
          execSync('git add js/ai-training-progress.json js/ai-weights.json', { cwd: repoRoot, stdio: 'pipe' });
          execSync('git commit -m "chore(ai): training complete v' + weights.version + ' [skip ci]"', { cwd: repoRoot, stdio: 'pipe' });
          execSync('git push', { cwd: repoRoot, stdio: 'pipe' });
          console.log('Final commit pushed.');
        } catch (e) {
          console.log('Git push error: ' + (e.stderr ? e.stderr.toString().trim() : e.message));
        }
      } catch (e) {
        console.log('Final commit error: ' + e.message);
      }
    }
  });
}
