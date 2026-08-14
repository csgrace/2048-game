/* ========================================================================
   server.js — Express + SSE server for cloud-based AI training on Render.
   
   Endpoints:
     GET  /health     — health check
     GET  /stream     — SSE stream for real-time training progress
     POST /start      — start a training run { games, lr, warmup }
     GET  /status     — get current training status
     POST /commit     — commit weights back to GitHub repo (called by server after training)
   ======================================================================== */

var express = require('express');
var path = require('path');
var app = express();
var train = require('./scripts/train-ai.js');

app.use(express.json());
app.use(function (req, res, next) {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

var PORT = process.env.PORT || 3000;

/* ---------- Global training state ---------- */
var trainingState = {
  active: false,
  progress: [],
  status: 'idle',
  startTime: null,
  games: 0,
  currentGame: 0,
  error: null
};

/* ---------- SSE clients ---------- */
var sseClients = [];

function broadcastSSE(event, data) {
  var msg = 'event: ' + event + '\ndata: ' + JSON.stringify(data) + '\n\n';
  sseClients.forEach(function (res) {
    try { res.write(msg); } catch (e) { /* client gone */ }
  });
}

/* ---------- Health check ---------- */
app.get('/health', function (req, res) {
  res.json({ ok: true, state: trainingState });
});

/* ---------- SSE stream ---------- */
app.get('/stream', function (req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*'
  });
  res.write('\n');

  // Send current state immediately
  if (trainingState.active) {
    res.write('event: status\ndata: ' + JSON.stringify(trainingState) + '\n\n');
    // Send accumulated progress
    trainingState.progress.forEach(function (p) {
      res.write('event: progress\ndata: ' + JSON.stringify(p) + '\n\n');
    });
  } else {
    res.write('event: status\ndata: ' + JSON.stringify(trainingState) + '\n\n');
  }

  sseClients.push(res);
  req.on('close', function () {
    var idx = sseClients.indexOf(res);
    if (idx >= 0) sseClients.splice(idx, 1);
  });
});

/* ---------- Start training ---------- */
app.post('/start', function (req, res) {
  if (trainingState.active) {
    return res.status(409).json({ error: 'Training already in progress', state: trainingState });
  }

  var games = (req.body && req.body.games) || 100;
  var lr = (req.body && req.body.lr) || 0.002;
  var warmup = (req.body && req.body.warmup) || 30;

  // Fetch existing weights from GitHub raw
  var GH_OWNER = process.env.GH_OWNER || 'csgrace';
  var GH_REPO = process.env.GH_REPO || '2048-game';
  var weightsUrl = 'https://raw.githubusercontent.com/' + GH_OWNER + '/' + GH_REPO + '/main/js/ai-weights.json';
  var https = require('https');

  trainingState.active = true;
  trainingState.progress = [];
  trainingState.status = 'loading_weights';
  trainingState.startTime = Date.now();
  trainingState.games = games;
  trainingState.currentGame = 0;
  trainingState.error = null;

  broadcastSSE('status', trainingState);
  res.json({ ok: true, message: 'Training started', games: games });

  https.get(weightsUrl, function (ghRes) {
    var body = '';
    ghRes.on('data', function (chunk) { body += chunk; });
    ghRes.on('end', function () {
      var existingWeights = null;
      try {
        var parsed = JSON.parse(body);
        if (parsed && parsed.l1W && parsed.l1W.length > 100) existingWeights = parsed;
      } catch (e) { /* no weights */ }

      trainingState.status = 'training';
      broadcastSSE('status', trainingState);

      try {
        train.run({
          games: games,
          lr: lr,
          warmup: warmup,
          existingWeights: existingWeights,
          onProgress: function (data) {
            if (data.type === 'start') {
              broadcastSSE('start', data);
            } else if (data.type === 'nn_enabled') {
              broadcastSSE('nn_enabled', data);
            } else if (data.type === 'progress') {
              trainingState.currentGame = data.game;
              trainingState.progress.push(data);
              broadcastSSE('progress', data);
            }
          },
          onComplete: function (weights) {
            trainingState.status = 'committing';
            broadcastSSE('status', trainingState);

            // Commit weights to GitHub repo via API
            commitWeightsToGitHub(weights, function (ok, msg) {
              trainingState.active = false;
              trainingState.status = ok ? 'done' : 'commit_failed';
              broadcastSSE('complete', {
                weights: { version: weights.version, bestMaxTile: weights.bestMaxTile, avgScore: weights.avgScore, trainTime: weights.trainTime },
                history: weights.history,
                committed: ok,
                commitMessage: msg
              });
              broadcastSSE('status', trainingState);
              console.log('Training complete. Commit: ' + (ok ? 'success' : 'failed') + ' - ' + msg);
            });
          }
        });
      } catch (e) {
        trainingState.active = false;
        trainingState.status = 'error';
        trainingState.error = e.message;
        broadcastSSE('error', { message: e.message });
        broadcastSSE('status', trainingState);
        console.error('Training error:', e);
      }
    });
  }).on('error', function (e) {
    // Can't load weights, start fresh
    trainingState.status = 'training';
    broadcastSSE('status', trainingState);
    try {
      train.run({
        games: games, lr: lr, warmup: warmup,
        onProgress: function (data) { broadcastSSE(data.type, data); },
        onComplete: function (weights) {
          commitWeightsToGitHub(weights, function (ok, msg) {
            trainingState.active = false;
            trainingState.status = ok ? 'done' : 'commit_failed';
            broadcastSSE('complete', { weights: weights, committed: ok, commitMessage: msg });
            broadcastSSE('status', trainingState);
          });
        }
      });
    } catch (err) {
      trainingState.active = false;
      trainingState.status = 'error';
      trainingState.error = err.message;
      broadcastSSE('error', { message: err.message });
    }
  });
});

/* ---------- Status ---------- */
app.get('/status', function (req, res) {
  res.json(trainingState);
});

/* ---------- Commit weights to GitHub repo via REST API ---------- */
function commitWeightsToGitHub(weights, callback) {
  var GH_TOKEN = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  var GH_OWNER = process.env.GH_OWNER || 'csgrace';
  var GH_REPO = process.env.GH_REPO || '2048-game';
  var weightsPath = 'js/ai-weights.json';

  if (!GH_TOKEN) {
    console.log('No GH_TOKEN set, weights will not be committed to repo.');
    return callback(false, 'No GH_TOKEN configured');
  }

  var weightsJson = JSON.stringify(weights, null, 2);
  var contentBase64 = Buffer.from(weightsJson).toString('base64');

  var https = require('https');
  var apiUrl = 'https://api.github.com/repos/' + GH_OWNER + '/' + GH_REPO + '/contents/' + weightsPath;

  // First, get current file SHA
  var getOpts = {
    hostname: 'api.github.com',
    path: '/repos/' + GH_OWNER + '/' + GH_REPO + '/contents/' + weightsPath,
    method: 'GET',
    headers: {
      'Authorization': 'Bearer ' + GH_TOKEN,
      'Accept': 'application/vnd.github+json',
      'User-Agent': '2048-ai-trainer',
      'X-GitHub-Api-Version': '2022-11-28'
    }
  };

  var reqGet = https.request(getOpts, function (res) {
    var body = '';
    res.on('data', function (c) { body += c; });
    res.on('end', function () {
      var sha = null;
      try { sha = JSON.parse(body).sha; } catch (e) { /* file might not exist */ }

      // Now PUT the updated file
      var putData = JSON.stringify({
        message: 'chore(ai): update trained weights v' + weights.version + ' [skip ci]',
        content: contentBase64,
        sha: sha
      });

      var putOpts = {
        hostname: 'api.github.com',
        path: '/repos/' + GH_OWNER + '/' + GH_REPO + '/contents/' + weightsPath,
        method: 'PUT',
        headers: {
          'Authorization': 'Bearer ' + GH_TOKEN,
          'Accept': 'application/vnd.github+json',
          'User-Agent': '2048-ai-trainer',
          'X-GitHub-Api-Version': '2022-11-28',
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(putData)
        }
      };

      var reqPut = https.request(putOpts, function (resPut) {
        var putBody = '';
        resPut.on('data', function (c) { putBody += c; });
        resPut.on('end', function () {
          if (resPut.statusCode === 200 || resPut.statusCode === 201) {
            callback(true, 'Weights committed v' + weights.version);
          } else {
            console.error('Commit failed:', resPut.statusCode, putBody);
            callback(false, 'HTTP ' + resPut.statusCode);
          }
        });
      });

      reqPut.on('error', function (e) {
        callback(false, e.message);
      });

      reqPut.write(putData);
      reqPut.end();
    });
  });

  reqGet.on('error', function (e) {
    callback(false, e.message);
  });

  reqGet.end();
}

/* ---------- Serve static files (for local testing) ---------- */
app.use(express.static(path.join(__dirname)));

app.listen(PORT, function () {
  console.log('2048 AI Training Server running on port ' + PORT);
});
