/* ====================================================================
   ai-brain.js — Neural value network + TD learning for 2048
   Architecture: MLP 256→96→48→16→1 with ReLU and tanh output
   Training: TD(λ) with Adam optimiser on self-play trajectories
   Board encoding: one-hot log2 per cell, 16 channels × 4 × 4 = 256
   ==================================================================== */
(function (root) {
  'use strict';

  /* ---------- board → neural network input encoding ---------- */
  // Uses log2 value (1-based) in one-hot: channel 0 = empty tile, channel v-1 = value 2^v
  // This gives a sparse but richly channeled representation.
  var CHANNELS = 16; // supports up to tile value 65536 (2^16)
  var INPUT_SIZE = 16 * CHANNELS; // 4x4 grid × 16 channels

  function encodeBoard(board, out) {
    out = out || new Float32Array(INPUT_SIZE);
    out.fill(0);
    for (var r = 0; r < 4; r++) {
      for (var c = 0; c < 4; c++) {
        var v = board[r][c];
        var ch = v > 0 ? Math.min(Math.log2(v) | 0, CHANNELS - 1) : 0;
        out[r * 4 * CHANNELS + c * CHANNELS + ch] = 1;
      }
    }
    return out;
  }

  /* ---------- Matrix helpers ---------- */
  function mat(rows, cols, init) {
    var m = new Float32Array(rows * cols);
    if (init === 'he') {
      var scale = Math.sqrt(2 / cols);
      for (var i = 0; i < m.length; i++) m[i] = randn() * scale;
    } else if (init === 'xavier') {
      var s = Math.sqrt(6 / (rows + cols));
      for (var i = 0; i < m.length; i++) m[i] = (Math.random() * 2 - 1) * s;
    }
    return m;
  }
  function randn() {
    var u = 1 - Math.random(), v = Math.random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(6.283185307 * v);
  }

  /* ---------- Layer ---------- */
  function Linear(inF, outF, initType) {
    this.inF = inF;
    this.outF = outF;
    this.W = mat(outF, inF, initType || 'he');
    this.b = new Float32Array(outF);
    // Adam state
    this.mW = new Float32Array(inF * outF); this.vW = new Float32Array(inF * outF);
    this.mB = new Float32Array(outF); this.vB = new Float32Array(outF);
    // gradients
    this.gW = new Float32Array(inF * outF); this.gB = new Float32Array(outF);
    // I/O cache for backward
    this.inC = new Float32Array(inF);
    this.outC = new Float32Array(outF);
  }
  Linear.prototype.forward = function (input, output) {
    var i, j, o;
    for (i = 0; i < this.inF; i++) this.inC[i] = input[i];
    for (o = 0; o < this.outF; o++) {
      var sum = this.b[o];
      var off = o * this.inF;
      for (i = 0; i < this.inF; i++) sum += this.W[off + i] * input[i];
      output[o] = sum > 0 ? sum : 0; // ReLU
      this.outC[o] = output[o];
    }
    return output;
  };
  Linear.prototype.backward = function (gradOutput) {
    var i, o;
    // gradW and gradB
    for (o = 0; o < this.outF; o++) {
      var go = gradOutput[o] * (this.outC[o] > 0 ? 1 : 0); // ReLU derivative
      this.gB[o] = go;
      var off = o * this.inF;
      for (i = 0; i < this.inF; i++) this.gW[off + i] = go * this.inC[i];
    }
    // propagate gradient to input
    var gradInput = new Float32Array(this.inF);
    for (i = 0; i < this.inF; i++) {
      var sum = 0;
      for (o = 0; o < this.outF; o++) sum += this.W[o * this.inF + i] * gradOutput[o] * (this.outC[o] > 0 ? 1 : 0);
      gradInput[i] = sum;
    }
    return gradInput;
  };
  Linear.prototype.applyGradients = function (lr) {
    var i;
    for (i = 0; i < this.gW.length; i++) {
      this.mW[i] = ADAM_B1 * this.mW[i] + (1 - ADAM_B1) * this.gW[i];
      this.vW[i] = ADAM_B2 * this.vW[i] + (1 - ADAM_B2) * this.gW[i] * this.gW[i];
      var mHat = this.mW[i] / (1 - ADAM_B1_T);
      var vHat = this.vW[i] / (1 - ADAM_B2_T);
      this.W[i] -= lr * mHat / (Math.sqrt(vHat) + ADAM_EPS);
    }
    for (i = 0; i < this.gB.length; i++) {
      this.mB[i] = ADAM_B1 * this.mB[i] + (1 - ADAM_B1) * this.gB[i];
      this.vB[i] = ADAM_B2 * this.vB[i] + (1 - ADAM_B2) * this.gB[i] * this.gB[i];
      var mHat = this.mB[i] / (1 - ADAM_B1_T);
      var vHat = this.vB[i] / (1 - ADAM_B2_T);
      this.b[i] -= lr * mHat / (Math.sqrt(vHat) + ADAM_EPS);
    }
  };

  /* ---------- Adam hyper-params ---------- */
  var ADAM_B1 = 0.9, ADAM_B2 = 0.999, ADAM_EPS = 1e-8;
  var ADAM_B1_T = 1, ADAM_B2_T = 1;
  function adamStep() { ADAM_B1_T *= ADAM_B1; ADAM_B2_T *= ADAM_B2; }
  function adamReset() { ADAM_B1_T = 1; ADAM_B2_T = 1; }

  /* ---------- Value network: 256 → 96 → 48 → 16 → 1 ---------- */
  function ValueNet() {
    this.l1 = new Linear(INPUT_SIZE, 96, 'he');
    this.l2 = new Linear(96, 48, 'he');
    this.l3 = new Linear(48, 16, 'he');
    this.l4 = new Linear(16, 1, 'xavier');
    this.buf1 = new Float32Array(96);
    this.buf2 = new Float32Array(48);
    this.buf3 = new Float32Array(16);
  }
  ValueNet.prototype.forward = function (input) {
    this.l1.forward(input, this.buf1);
    this.l2.forward(this.buf1, this.buf2);
    this.l3.forward(this.buf2, this.buf3);
    this.l4.forward(this.buf3, this.buf4 || (this.buf4 = new Float32Array(1)));
    // tanh output → squash to [-1, 1]
    var x = this.buf4[0];
    this.buf4[0] = x > 20 ? 1 : x < -20 ? -1 : (Math.exp(2 * x) - 1) / (Math.exp(2 * x) + 1);
    return this.buf4[0];
  };
  ValueNet.prototype.trainStep = function (batch, lr) {
    // batch: [{input, target, weight}]
    var totalLoss = 0;
    // accumulate gradients
    for (var s = 0; s < batch.length; s++) {
      var sample = batch[s];
      var pred = this.forward(sample.input);
      var error = pred - sample.target;
      totalLoss += error * error;
      // output layer gradient (chain rule through tanh(2x))
      // d/dx tanh(2x) = 2(1 - tanh²(2x)); MSE d/dpred = 2*error
      var dOut = 4 * error * (1 - pred * pred) * sample.weight; // 2×MSE × 2×tanh' × importance
      var gradToL4Input = this.l4.backward([dOut]);
      var gradToL3Input = this.l3.backward(gradToL4Input);
      var gradToL2Input = this.l2.backward(gradToL3Input);
      this.l1.backward(gradToL2Input); // discard final output gradient
    }
    // apply averaged gradients
    var scale = 1 / batch.length;
    var layers = [this.l1, this.l2, this.l3, this.l4];
    for (var i = 0; i < layers.length; i++) {
      var l = layers[i];
      for (var j = 0; j < l.gW.length; j++) l.gW[j] *= scale;
      for (j = 0; j < l.gB.length; j++) l.gB[j] *= scale;
      l.applyGradients(lr);
    }
    adamStep();
    return totalLoss / batch.length;
  };

  /* ---------- Serialize / deserialize ---------- */
  ValueNet.prototype.exportWeights = function () {
    return {
      l1W: Array.from(this.l1.W), l1b: Array.from(this.l1.b),
      l2W: Array.from(this.l2.W), l2b: Array.from(this.l2.b),
      l3W: Array.from(this.l3.W), l3b: Array.from(this.l3.b),
      l4W: Array.from(this.l4.W), l4b: Array.from(this.l4.b),
      adam_t: ADAM_B1_T
    };
  };
  ValueNet.prototype.importWeights = function (data) {
    if (!data) return;
    this.l1.W.set(data.l1W); this.l1.b.set(data.l1b);
    this.l2.W.set(data.l2W); this.l2.b.set(data.l2b);
    this.l3.W.set(data.l3W); this.l3.b.set(data.l3b);
    this.l4.W.set(data.l4W); this.l4.b.set(data.l4b);
    if (data.adam_t) { ADAM_B1_T = data.adam_t; ADAM_B2_T = Math.pow(ADAM_B2, Math.log(data.adam_t) / Math.log(ADAM_B1 + 1e-10)); }
  };

  /* ---------- Self-play trajectory ---------- */
  // We record each position visited so we can bootstrap TD(λ) returns.
  function Trajectory() { this.positions = []; this.rewards = []; }
  Trajectory.prototype.add = function (board, reward) {
    this.positions.push(encodeBoard(board));
    this.rewards.push(reward);
  };
  /* TD(λ) target computation from a completed game */
  Trajectory.prototype.computeTargets = function (gamma, lambda, netOut) {
    var T = this.rewards.length;
    var targets = new Float32Array(T);
    // rewards are already normalized in the worker (gained/200 + heuristic_delta/5000)
    // so we use them directly here without further scaling
    for (var t = 0; t < T; t++) {
      if (t === T - 1) targets[t] = this.rewards[t]; // terminal: only immediate reward
      else {
        var g = 0;
        for (var n = 1; n <= Math.min(8, T - t); n++) {
          var end = t + n;
          var boot = end < T ? netOut(this.positions[end]) : 0;
          var sumR = 0;
          for (var k = t; k < end; k++) sumR += Math.pow(gamma, k - t) * this.rewards[k];
          g += Math.pow(lambda, n - 1) * (sumR + Math.pow(gamma, end - t) * boot);
          if (n > 1) g *= (1 - lambda);
        }
        targets[t] = Math.max(-1, Math.min(1, g));
      }
    }
    return targets;
  };

  /* ---------- Exports ---------- */
  root.AIBrain = {
    ValueNet: ValueNet,
    Trajectory: Trajectory,
    encodeBoard: encodeBoard,
    INPUT_SIZE: INPUT_SIZE,
    CHANNELS: CHANNELS,
    adamReset: adamReset,
    adamStep: adamStep
  };
})(typeof self !== 'undefined' ? self : this);
