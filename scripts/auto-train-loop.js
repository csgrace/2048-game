/* ====================================================================
   auto-train-loop.js — Autonomous train→test→confirm loop.
   
   Strategy:
   1. Train N games (improve weights)
   2. Test with 10 games (quick check)
   3. If win rate = 100%, run confirmation test with 20 more games
   4. If confirmation also 100%, stop (target reached)
   5. If quick test or confirmation fails, go back to step 1
   6. Push progress to git each cycle
   
   File lock: checks ai-backend-status.json for active=true on startup.
   Only one train/test action can run at a time.
   
   Usage: node scripts/auto-train-loop.js [--target=100] [--maxRounds=50]
   ==================================================================== */

'use strict';

var fs = require('fs');
var path = require('path');
var vm = require('vm');
var execSync = require('child_process').execSync;

/* ---------- CLI args ---------- */
var args = {};
process.argv.slice(2).forEach(function (a) {
  var m = a.match(/^--(\w+)(?:=(.+))?$/);
  if (m) args[m[1]] = m[2] === undefined ? true : m[2];
});

var TARGET_WIN_RATE = parseInt(args.target || '100', 10);
var MAX_ROUNDS = parseInt(args.maxRounds || '50', 10);
var TRAIN_GAMES = parseInt(args.trainGames || '200', 10);
var TEST_GAMES = parseInt(args.testGames || '10', 10);       // quick test: 10 games
var CONFIRM_GAMES = parseInt(args.confirmGames || '20', 10); // confirmation test: 20 games

var repoRoot = path.join(__dirname, '..');
var weightsPath = path.join(repoRoot, 'js', 'ai-weights.json');
var progressPath = path.join(repoRoot, 'js', 'ai-playtest-progress.json');
var loopLogPath = path.join(repoRoot, 'js', 'auto-train-log.json');
var statusPath = path.join(repoRoot, 'js', 'ai-backend-status.json');

/* ---------- Backend status file (for frontend monitoring + file lock) ---------- */
function writeBackendStatus(status) {
  status.lastUpdate = new Date().toISOString();
  fs.writeFileSync(statusPath, JSON.stringify(status, null, 2));
}

/* ---------- File lock: ensure only one train/test at a time ---------- */
function tryAcquireLock() {
  try {
    var raw = fs.readFileSync(statusPath, 'utf8');
    var existing = JSON.parse(raw);
    if (existing && existing.active) {
      console.error('❌ Another train/test process is already running (phase: ' + (existing.phase || 'unknown') + ', started: ' + (existing.lastUpdate || 'unknown') + ')');
      console.error('   If this is a stale lock, delete js/ai-backend-status.json and retry.');
      process.exit(1);
    }
  } catch (e) {
    // No status file = no lock, proceed
  }
}

/* ---------- Cleanup on exit ---------- */
function releaseLock() {
  try {
    writeBackendStatus({
      active: false,
      phase: 'idle',
      message: 'Process exited — backend released lock'
    });
  } catch (e) {}
}
process.on('exit', releaseLock);
process.on('SIGINT', function () { process.exit(0); });
process.on('SIGTERM', function () { process.exit(0); });

/* ---------- Load ai-brain.js ---------- */
var brainSrc = fs.readFileSync(path.join(repoRoot, 'js', 'ai-brain.js'), 'utf8');
var brainSandbox = {};
vm.createContext(brainSandbox);
vm.runInContext(brainSrc, brainSandbox);
var AIBrain = brainSandbox.AIBrain;

/* ---------- Load train-ai.js as module ---------- */
var trainModule = require('./train-ai.js');

/* ========================================================================
   Playtest logic (copied from playtest-ai.js to run in-process)
   ======================================================================== */
var AI_DIRECTIONS = ['up', 'left', 'down', 'right'];
var AI_BUDGET_MS = 60;

function aiClone(grid) { return grid.map(function (r) { return r.slice(); }); }

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
    var line = direction === 'left' || direction === 'right' ? next[index].slice() : next.map(function (r) { return r[index]; });
    if (direction === 'right' || direction === 'down') line.reverse();
    var res = aiSlide(line); line = res.line;
    if (direction === 'right' || direction === 'down') line.reverse();
    var original = direction === 'left' || direction === 'right' ? next[index].slice() : next.map(function (r) { return r[index]; });
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

/* ---------- NN-aware evaluation (same as playtest-ai.js) ---------- */
var aiNet = null;
var aiUseNN = false;
var aiTrainGames = 0;
var INPUT_SIZE = AIBrain.INPUT_SIZE;

function loadWeights() {
  try {
    var raw = fs.readFileSync(weightsPath, 'utf8');
    var w = JSON.parse(raw);
    aiNet = new AIBrain.ValueNet();
    if (w && w.l1W && w.l1W.length > 100) {
      aiNet.importWeights(w);
      aiTrainGames = w.version || 0;
      aiUseNN = aiTrainGames > 30;
    }
  } catch (e) {
    console.log('No weights to load: ' + e.message);
  }
}

function aiNeuralEvaluate(grid) {
  if (!aiUseNN || !aiNet) return aiEvaluate(grid);
  var input = AIBrain.encodeBoard(grid, new Float32Array(INPUT_SIZE));
  var raw = aiNet.forward(input);
  var nnWeight = Math.min(0.8, aiTrainGames / 300);
  return aiEvaluate(grid) * (1 - nnWeight) + raw * 5000 * nnWeight;
}

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

function aiBestMove(grid) {
  var table = new Map();
  var start = Date.now();
  var bestDirection = null;
  for (var targetDepth = 2; targetDepth <= 6; targetDepth++) {
    var localBest = null, localScore = -Infinity, completed = true;
    for (var i = 0; i < AI_DIRECTIONS.length; i++) {
      var result = aiMoveBoard(grid, AI_DIRECTIONS[i]);
      if (!result.changed) continue;
      var value = result.gained + aiExpectimax(result.board, targetDepth, true, table);
      if (value > localScore) { localScore = value; localBest = AI_DIRECTIONS[i]; }
    }
    if (Date.now() - start > AI_BUDGET_MS) { completed = false; }
    if (completed && localBest) { bestDirection = localBest; }
    if (!completed) break;
  }
  // Monte Carlo tie-break
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

/* ---------- Game helpers ---------- */
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

/* ---------- Run one test game ---------- */
function runTestGame(gameIdx) {
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
    var empties = aiEmptyCells(grid);
    if (empties.length) {
      var p = empties[Math.floor(Math.random() * empties.length)];
      grid[p[0]][p[1]] = Math.random() < 0.9 ? 2 : 4;
    }
  }
  var duration = Date.now() - startTime;
  var mt = maxTile(grid);
  return { game: gameIdx, result: mt >= 2048 ? 'win' : 'fail', score: score, maxTile: mt, steps: steps, duration: duration };
}

/* ---------- Run a full playtest ---------- */
function runPlaytest(numGames, roundNum) {
  console.log('\n--- Running playtest: ' + numGames + ' games ---');
  loadWeights(); // reload latest weights
  var results = [];
  for (var i = 1; i <= numGames; i++) {
    var r = runTestGame(i);
    results.push(r);
    var winStr = r.result === 'win' ? 'WIN' : 'LOSS';
    console.log('  Game ' + i + '/' + numGames + ': ' + winStr + ' score=' + r.score + ' max=' + r.maxTile + ' steps=' + r.steps + ' time=' + r.duration + 'ms');
    
    // Update progress file during playtest (every game)
    var partialWins = results.filter(function (g) { return g.result === 'win'; }).length;
    var partialData = {
      active: i < numGames,
      timestamp: new Date().toISOString(),
      totalGames: numGames,
      completedGames: i,
      wins: partialWins,
      fails: i - partialWins,
      winRate: Math.round(partialWins / i * 100),
      avgScore: Math.round(results.reduce(function (a, b) { return a + b.score; }, 0) / i),
      bestMaxTile: Math.max.apply(null, results.map(function (g) { return g.maxTile; })),
      totalDurationMs: results.reduce(function (a, b) { return a + b.duration; }, 0),
      results: results.slice()
    };
    fs.writeFileSync(progressPath, JSON.stringify(partialData, null, 2));
    
    // Also update backend status
    writeBackendStatus({
      active: true,
      phase: 'testing',
      round: roundNum,
      maxRounds: MAX_ROUNDS,
      version: aiTrainGames,
      testProgress: i + '/' + numGames,
      wins: partialWins,
      winRate: partialData.winRate,
      message: 'Testing game ' + i + '/' + numGames + ' - ' + partialWins + ' wins (' + partialData.winRate + '%)'
    });
  }
  var wins = results.filter(function (g) { return g.result === 'win'; }).length;
  var winRate = Math.round(wins / results.length * 100);
  var avgScore = Math.round(results.reduce(function (a, b) { return a + b.score; }, 0) / results.length);
  var bestMax = Math.max.apply(null, results.map(function (g) { return g.maxTile; }));
  console.log('--- Playtest result: ' + wins + '/' + results.length + ' wins (' + winRate + '%), avg score=' + avgScore + ', best max=' + bestMax + ' ---\n');
  
  // Save final progress file
  var data = {
    active: false,
    timestamp: new Date().toISOString(),
    totalGames: numGames,
    completedGames: numGames,
    wins: wins,
    fails: numGames - wins,
    winRate: winRate,
    avgScore: avgScore,
    bestMaxTile: bestMax,
    totalDurationMs: results.reduce(function (a, b) { return a + b.duration; }, 0),
    results: results
  };
  fs.writeFileSync(progressPath, JSON.stringify(data, null, 2));
  
  return { winRate: winRate, wins: wins, total: numGames, avgScore: avgScore, bestMax: bestMax, results: results };
}

/* ---------- Git push ---------- */
function gitPush(msg) {
  try {
    execSync('git add -A', { cwd: repoRoot, stdio: 'pipe' });
    execSync('git commit -m "' + msg + ' [skip ci]"', { cwd: repoRoot, stdio: 'pipe' });
    execSync('git push', { cwd: repoRoot, stdio: 'pipe' });
    console.log('[Pushed: ' + msg + ']');
  } catch (e) {
    console.log('[Git push error: ' + (e.stderr ? e.stderr.toString().trim() : e.message) + ']');
  }
}

/* ---------- Save loop log ---------- */
var loopLog = [];
try {
  loopLog = JSON.parse(fs.readFileSync(loopLogPath, 'utf8') || '[]');
} catch (e) {}

function saveLoopLog() {
  fs.writeFileSync(loopLogPath, JSON.stringify(loopLog, null, 2));
}

/* ========================================================================
   Main loop — Test first, then train if needed
   ======================================================================== */

// Check file lock before starting
tryAcquireLock();

console.log('========================================================');
console.log('  Auto Train-Test-Confirm Loop');
console.log('  Target: ' + TARGET_WIN_RATE + '% win rate (all games reach 2048)');
console.log('  Max rounds: ' + MAX_ROUNDS);
console.log('  Train games per round: ' + TRAIN_GAMES);
console.log('  Quick test: ' + TEST_GAMES + ' games');
console.log('  Confirm test: ' + CONFIRM_GAMES + ' games (only if quick test passes)');
console.log('  File lock: active (only one process at a time)');
console.log('========================================================');

for (var round = 1; round <= MAX_ROUNDS; round++) {
  console.log('\n********************************************************');
  console.log('  ROUND ' + round + ' / ' + MAX_ROUNDS);
  console.log('********************************************************');
  
  // Load existing weights
  var existingWeights = null;
  try {
    existingWeights = JSON.parse(fs.readFileSync(weightsPath, 'utf8'));
    if (!existingWeights || !existingWeights.l1W || existingWeights.l1W.length < 100) existingWeights = null;
  } catch (e) {}
  
  var currentVersion = existingWeights ? (existingWeights.version || 0) : 0;
  
  // ---- Step 1: TRAIN ----
  // Adaptive hyperparams
  var lr = 0.002;
  var warmup = 30;
  if (round > 5) lr = 0.003;
  if (round > 10) lr = 0.004;
  if (round > 20) lr = 0.005;
  
  // Adjust train games based on last round's performance
  var trainGames = TRAIN_GAMES;
  if (round > 3 && loopLog.length > 0) {
    var lastLog = loopLog[loopLog.length - 1];
    if (lastLog.winRate < 30) trainGames = TRAIN_GAMES * 2;
  }
  
  console.log('Step 1: Training ' + trainGames + ' games (lr=' + lr + ', warmup=' + warmup + ', base v' + currentVersion + ')...');
  
  writeBackendStatus({
    active: true,
    phase: 'training',
    round: round,
    maxRounds: MAX_ROUNDS,
    version: currentVersion,
    trainGames: trainGames,
    testGames: TEST_GAMES,
    lr: lr,
    message: 'Round ' + round + '/' + MAX_ROUNDS + ' - TRAINING ' + trainGames + ' games (lr=' + lr + ', base v' + currentVersion + ')'
  });
  
  var trainStart = Date.now();
  var weights = trainModule.run({
    games: trainGames,
    lr: lr,
    warmup: warmup,
    existingWeights: existingWeights,
    onProgress: function () {},
    onComplete: function () {}
  });
  var trainTime = ((Date.now() - trainStart) / 1000).toFixed(1);
  console.log('Training done in ' + trainTime + 's. New version: v' + weights.version);
  
  // Save weights
  fs.writeFileSync(weightsPath, JSON.stringify(weights, null, 2));
  
  // Log training result
  var lastHistory = weights.history && weights.history.length ? weights.history[weights.history.length - 1] : null;
  var trainLogEntry = {
    round: round,
    phase: 'train',
    version: weights.version,
    trainGames: trainGames,
    lr: lr,
    trainTime: trainTime + 's',
    loss: lastHistory ? lastHistory.loss : 0,
    bestMaxTile: weights.bestMaxTile || 0,
    avgScore: weights.avgScore || 0,
    timestamp: new Date().toISOString()
  };
  loopLog.push(trainLogEntry);
  saveLoopLog();
  
  // Push training results
  gitPush('auto-train: round ' + round + ' TRAIN v' + weights.version + ' (base v' + currentVersion + ', ' + trainGames + ' games)');
  
  // Write brief idle status
  writeBackendStatus({
    active: false,
    phase: 'idle',
    round: round,
    maxRounds: MAX_ROUNDS,
    version: weights.version,
    trainGames: trainGames,
    trainTime: trainTime + 's',
    lr: lr,
    loss: lastHistory ? lastHistory.loss : 0,
    bestMaxTile: weights.bestMaxTile || 0,
    avgScore: weights.avgScore || 0,
    message: 'Round ' + round + ' trained v' + weights.version + ' in ' + trainTime + 's - starting quick test...'
  });
  
  // ---- Step 2: QUICK TEST (10 games) ----
  console.log('\nStep 2: Quick testing new weights (v' + weights.version + ') with ' + TEST_GAMES + ' games...');
  writeBackendStatus({
    active: true,
    phase: 'testing',
    round: round,
    maxRounds: MAX_ROUNDS,
    version: weights.version,
    trainGames: 0,
    testGames: TEST_GAMES,
    testPhase: 'quick',
    message: 'Round ' + round + '/' + MAX_ROUNDS + ' - QUICK TEST v' + weights.version + ' with ' + TEST_GAMES + ' games'
  });
  
  var testResult = runPlaytest(TEST_GAMES, round);
  
  // Log quick test result
  var testLogEntry = {
    round: round,
    phase: 'test',
    testPhase: 'quick',
    version: weights.version,
    testWins: testResult.wins,
    testTotal: testResult.total,
    winRate: testResult.winRate,
    avgScore: testResult.avgScore,
    bestMax: testResult.bestMax,
    timestamp: new Date().toISOString()
  };
  loopLog.push(testLogEntry);
  saveLoopLog();
  gitPush('auto-train: round ' + round + ' QUICK TEST v' + weights.version + ' winRate=' + testResult.winRate + '% (' + testResult.wins + '/' + testResult.total + ')');
  
  // ---- Step 3: CHECK QUICK TEST RESULT ----
  if (testResult.winRate < TARGET_WIN_RATE) {
    // Quick test failed, continue training next round
    console.log('\nQuick test ' + testResult.winRate + '% < target ' + TARGET_WIN_RATE + '%, will train more next round...');
    
    // Adaptive strategy: increase train games if no improvement
    if (loopLog.length >= 3) {
      var lastTestLog2 = null;
      for (var k = loopLog.length - 1; k >= 0; k--) {
        if (loopLog[k].phase === 'test') { lastTestLog2 = loopLog[k]; break; }
      }
      var prevTestLog2 = null;
      for (var k2 = k - 1; k2 >= 0; k2--) {
        if (loopLog[k2].phase === 'test') { prevTestLog2 = loopLog[k2]; break; }
      }
      if (lastTestLog2 && prevTestLog2 && lastTestLog2.winRate <= prevTestLog2.winRate) {
        console.log('No improvement from last test (' + prevTestLog2.winRate + '% -> ' + lastTestLog2.winRate + '%), increasing train games...');
        TRAIN_GAMES = Math.min(TRAIN_GAMES + 50, 500);
      }
    }
    continue; // go to next round (train more)
  }
  
  // ---- Step 4: CONFIRMATION TEST (20 games) ----
  // Quick test passed (100%), now confirm with more games
  console.log('\n✅ Quick test passed! ' + testResult.winRate + '% win rate (' + testResult.wins + '/' + testResult.total + ')');
  console.log('Step 4: Running confirmation test with ' + CONFIRM_GAMES + ' games...');
  
  writeBackendStatus({
    active: true,
    phase: 'testing',
    round: round,
    maxRounds: MAX_ROUNDS,
    version: weights.version,
    trainGames: 0,
    testGames: CONFIRM_GAMES,
    testPhase: 'confirm',
    message: 'Round ' + round + '/' + MAX_ROUNDS + ' - CONFIRM TEST v' + weights.version + ' with ' + CONFIRM_GAMES + ' games (quick test passed!)'
  });
  
  var confirmResult = runPlaytest(CONFIRM_GAMES, round);
  
  // Log confirmation test result
  var confirmLogEntry = {
    round: round,
    phase: 'test',
    testPhase: 'confirm',
    version: weights.version,
    testWins: confirmResult.wins,
    testTotal: confirmResult.total,
    winRate: confirmResult.winRate,
    avgScore: confirmResult.avgScore,
    bestMax: confirmResult.bestMax,
    timestamp: new Date().toISOString()
  };
  loopLog.push(confirmLogEntry);
  saveLoopLog();
  gitPush('auto-train: round ' + round + ' CONFIRM TEST v' + weights.version + ' winRate=' + confirmResult.winRate + '% (' + confirmResult.wins + '/' + confirmResult.total + ')');
  
  // ---- Step 5: CHECK CONFIRMATION RESULT ----
  if (confirmResult.winRate >= TARGET_WIN_RATE) {
    // 🎉 TARGET REACHED!
    console.log('\n🎉🎉 TARGET REACHED! Confirmation test ' + confirmResult.winRate + '% >= ' + TARGET_WIN_RATE + '%');
    console.log('Quick test: ' + testResult.winRate + '% (' + testResult.wins + '/' + testResult.total + ')');
    console.log('Confirm test: ' + confirmResult.winRate + '% (' + confirmResult.wins + '/' + confirmResult.total + ')');
    console.log('Total rounds: ' + round);
    console.log('Final version: v' + weights.version);
    writeBackendStatus({
      active: false,
      phase: 'idle',
      round: round,
      maxRounds: MAX_ROUNDS,
      version: weights.version,
      winRate: confirmResult.winRate,
      wins: confirmResult.wins,
      testTotal: confirmResult.total,
      avgScore: confirmResult.avgScore,
      bestMax: confirmResult.bestMax,
      message: '🎯 TARGET REACHED! v' + weights.version + ' - Quick: ' + testResult.winRate + '%, Confirm: ' + confirmResult.winRate + '% (' + confirmResult.wins + '/' + confirmResult.total + ' reached 2048)'
    });
    break;
  }
  
  // Confirmation test failed, continue training
  console.log('\n❌ Confirmation test failed: ' + confirmResult.winRate + '% < target ' + TARGET_WIN_RATE + '%');
  console.log('Quick test was ' + testResult.winRate + '% but confirmation only ' + confirmResult.winRate + '% - need more training...');
  
  writeBackendStatus({
    active: false,
    phase: 'idle',
    round: round,
    maxRounds: MAX_ROUNDS,
    version: weights.version,
    winRate: confirmResult.winRate,
    message: 'Round ' + round + ': Quick test passed but confirm failed (' + confirmResult.winRate + '%), will train more...'
  });
}

console.log('\n========================================================');
console.log('  Auto-train loop complete');
console.log('  Total rounds: ' + loopLog.filter(function(e){return e.phase==='train'}).length);
var lastTest = loopLog.filter(function(e){return e.phase==='test'}).pop();
console.log('  Final win rate: ' + (lastTest ? lastTest.winRate : 0) + '%');
console.log('========================================================');
console.log('\nLoop history:');
loopLog.forEach(function (e) {
  if (e.phase === 'test') {
    var label = e.testPhase === 'confirm' ? 'CONFIRM' : 'QUICK';
    console.log('  Round ' + e.round + ' ' + label + ' TEST: v' + e.version + ' | ' + e.winRate + '% (' + e.testWins + '/' + e.testTotal + ') | avg=' + e.avgScore + ' | best=' + e.bestMax);
  } else {
    console.log('  Round ' + e.round + ' TRAIN: v' + e.version + ' | ' + e.trainGames + ' games | lr=' + e.lr + ' | loss=' + (e.loss||0).toFixed(6) + ' | ' + e.trainTime);
  }
});
