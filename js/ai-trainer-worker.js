/* ====================================================================
   ai-trainer-worker.js — runs neural network training off the main thread.
   The worker generates self-play games and trains the value network,
   then posts updated weight snapshots back to the main thread.
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

/* Heuristic-guided playout — fast, used for initial training data */
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
  return e * 100 + structure * 5 + Math.log2(max || 1) * 20 + corner * 150 + smooth * 8 + merges * 100;
}
/* Pick best of four moves via one-ply heuristic lookup */
function pickMove(grid) {
  var best = -1, bestV = -Infinity;
  for (var d = 0; d < 4; d++) {
    var res = move(grid, d);
    if (!res.changed) continue;
    var v = heuristicValue(res.next) + res.gained;
    if (v > bestV) { bestV = v; best = d; }
  }
  return best;
}

/* ---------- Self-play one game ---------- */
function playOneGame() {
  var g = initRandom();
  var traj = new AIBrain.Trajectory();
  var score = 0;
  while (true) {
    var h = heuristicValue(g);
    traj.add(g, 0); // placeholder; reward filled on next merge
    var dir = pickMove(g);
    if (dir < 0) break;
    var res = move(g, dir);
    g = res.next;
    score += res.gained;
    // spawn new tile
    var e = empty(g); if (!e.length) break;
    var p = e[Math.random() * e.length | 0];
    g[p[0]][p[1]] = Math.random() < 0.9 ? 2 : 4;
    // record reward = normalized score gained + heuristic delta
    traj.rewards[traj.rewards.length - 1] = res.gained / 200 + (heuristicValue(g) - h) / 5000;
    if (!hasMoves(g)) break;
  }
  return { traj: traj, score: score, maxTile: Math.max.apply(null, g.map(function (r) { return Math.max.apply(null, r); })) };
}

/* ---------- Train one mini-batch step ---------- */
function trainStep(lr, batchSize) {
  if (buffer.length < batchSize) return 0;
  var batch = [];
  for (var i = 0; i < batchSize; i++) {
    var idx = Math.random() * buffer.length | 0;
    var sample = buffer[idx];
    batch.push({ input: sample.input, target: sample.target, weight: 1 });
  }
  var loss = net.trainStep(batch, lr);
  return loss;
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
    postMessage({ type: 'ready' });
  }
  if (d.cmd === 'pause') { shouldPause = true; }
  if (d.cmd === 'getWeights') { postMessage({ type: 'weights', data: net.exportWeights() }); }
  if (d.cmd === 'train') {
    gamesPerBatch = d.games || 200;
    gamesDoneBatch = 0;
    shouldPause = false;
    running = true;
    var lr = d.lr || 0.002;
    function loop() {
      if (!running || shouldPause) { running = false; return; }
      var result = learnFromGame();
      gamesDoneBatch++; totalGamesTrained++;
      // Train a few steps per game
      var ls = 0;
      for (var s = 0; s < 8; s++) ls += trainStep(lr, 64);
      ls /= 8;
      epochLoss = ls;
      postMessage({ type: 'progress', game: gamesDoneBatch, totalGames: gamesPerBatch, maxTile: result.maxTile, score: result.score, loss: ls, totalTrained: totalGamesTrained });
      if (gamesDoneBatch >= gamesPerBatch) {
        postMessage({ type: 'epoch', epoch: gamesPerBatch, loss: ls, weights: net.exportWeights(), totalTrained: totalGamesTrained });
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
