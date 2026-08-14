/* ====================================================================
   ai-trainer-worker.js — runs neural network training off the main thread.
   The worker generates self-play games using Expectimax search with
   neural network leaf evaluation, and trains the value network.
   Communication protocol:
     postMessage({cmd:'init'})                          — create fresh network
     postMessage({cmd:'train',games:200,lr:0.002})     — train on N new games
     postMessage({cmd:'pause'})                         — stop after current game
     postMessage({cmd:'getWeights'})                    — send weights back
   Worker posts:
     {type:'progress',game,totalGames,maxTile,score,loss}
     {type:'weights',data}       — full weight snapshot
     {type:'epoch',epoch,loss}   — completed an epoch over buffered data
     {type:'ready'}
   ==================================================================== */

importScripts('ai-brain.js');

var net = new AIBrain.ValueNet();
var buffer = [];          // replay buffer of {input, target}
var bufferMax = 8000;
var netOut = function (input) { return net.forward(input); };
var running = false, shouldPause = false;
var gamesPerBatch = 0, gamesDoneBatch = 0, totalGamesTrained = 0;
var epochLoss = 0;
var lastLossSample = 0;
var useNNLeaf = false;    // whether to use NN for leaf evaluation in Expectimax

/* ---------- Game-logic replicas (pure, for self-play) ---------- */
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

/* ---------- Heuristic evaluation (fallback + blend) ---------- */
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
  // Blend heuristic and NN: heuristic provides stability, NN provides learned signal
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
    // Max node: AI chooses best move
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
    // Chance node: random tile spawn (2 with 90%, 4 with 10%)
    var empties = empty(grid);
    if (!empties.length) {
      value = expectimax(grid, depth - 1, false, table);
    } else {
      // Sample if too many empty cells for performance
      var sample = empties.length > 4 ? empties.filter(function(_, i) { return i % Math.ceil(empties.length / 4) === 0; }) : empties;
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
  if (e >= 8) return 2;      // plenty of space, shallow search
  if (e >= 4) return 3;      // moderate
  if (e >= 2) return 4;      // tight, go deeper
  return 5;                   // critical situation, deepest search
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
    
    // Adaptive Expectimax depth
    var depth = getSearchDepth(g);
    var dir = pickMoveExpectimax(g, depth);
    
    if (dir < 0) break;
    var res = move(g, dir);
    g = res.next;
    score += res.gained;
    
    // Track max tile
    for (var r = 0; r < 4; r++) for (var c = 0; c < 4; c++) {
      if (g[r][c] > maxTile) maxTile = g[r][c];
    }
    
    // Spawn new tile
    var e = empty(g); if (!e.length) break;
    var p = e[Math.random() * e.length | 0];
    g[p[0]][p[1]] = Math.random() < 0.9 ? 2 : 4;
    
    // Record reward = normalized score gained + heuristic delta
    traj.rewards[traj.rewards.length - 1] = res.gained / 200 + (heuristicValue(g) - h) / 5000;
    if (!hasMoves(g)) break;
  }
  return { traj: traj, score: score, maxTile: maxTile };
}

/* ---------- Train one mini-batch step (sample-by-sample to avoid weight-sharing bug) ---------- */
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

/* ---------- Message handler ---------- */
self.onmessage = function (msg) {
  var d = msg.data;
  if (d.cmd === 'init') {
    net = new AIBrain.ValueNet();
    if (d.weights) net.importWeights(d.weights);
    AIBrain.adamReset();
    buffer = [];
    useNNLeaf = !!d.weights && d.useNN === true;
    postMessage({ type: 'ready', useNN: useNNLeaf });
  }
  if (d.cmd === 'pause') { shouldPause = true; }
  if (d.cmd === 'getWeights') { postMessage({ type: 'weights', data: net.exportWeights() }); }
  if (d.cmd === 'useNN') { 
    useNNLeaf = d.enabled !== false; 
    postMessage({ type: 'nnToggle', enabled: useNNLeaf });
  }
  if (d.cmd === 'train') {
    gamesPerBatch = d.games || 200;
    gamesDoneBatch = 0;
    shouldPause = false;
    running = true;
    var lr = d.lr || 0.002;
    // Enable NN leaf eval after warmup games
    var warmupThreshold = d.warmupGames || 30;
    
    function loop() {
      if (!running || shouldPause) { running = false; return; }
      var result = learnFromGame();
      gamesDoneBatch++; totalGamesTrained++;
      
      // Enable NN leaf evaluation after warmup
      if (!useNNLeaf && totalGamesTrained >= warmupThreshold) {
        useNNLeaf = true;
        postMessage({ type: 'nnEnabled', games: totalGamesTrained });
      }
      
      // Train a few steps per game
      var ls = 0;
      for (var s = 0; s < 8; s++) ls += trainStep(lr, 64);
      ls /= 8;
      epochLoss = ls;
      lastLossSample = ls;
      
      postMessage({ 
        type: 'progress', 
        game: gamesDoneBatch, 
        totalGames: gamesPerBatch, 
        maxTile: result.maxTile, 
        score: result.score, 
        loss: ls, 
        totalTrained: totalGamesTrained,
        useNN: useNNLeaf 
      });
      
      if (gamesDoneBatch >= gamesPerBatch) {
        postMessage({ 
          type: 'epoch', 
          epoch: gamesPerBatch, 
          loss: ls, 
          weights: net.exportWeights(), 
          totalTrained: totalGamesTrained,
          useNN: useNNLeaf 
        });
        running = false;
        return;
      }
      // yield to eventloop
      setTimeout(loop, 0);
    }
    loop();
  }
};

postMessage({ type: 'load' });
