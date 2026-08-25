#!/usr/bin/env node
/**
 * Benchmark: Test current hand-crafted evaluation at different search depths
 * This tells us how much win rate improves with deeper search
 */

const fs = require('fs');
const path = require('path');

// ============== Game Logic (must match index.html) ==============
function cloneBoard(b) { return [b[0].slice(), b[1].slice(), b[2].slice(), b[3].slice()]; }

function emptyCells(b) {
  const cells = [];
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) if (b[r][c] === 0) cells.push([r, c]);
  return cells;
}

function slideLeft(line) {
  const vals = line.filter(v => v > 0);
  let gained = 0;
  const result = [];
  let i = 0;
  while (i < vals.length) {
    if (i + 1 < vals.length && vals[i] === vals[i + 1]) {
      const merged = vals[i] * 2;
      result.push(merged); gained += merged; i += 2;
    } else { result.push(vals[i]); i++; }
  }
  while (result.length < 4) result.push(0);
  return { result, gained };
}

function applyMove(board, dir) {
  const next = cloneBoard(board);
  let gained = 0;
  for (let i = 0; i < 4; i++) {
    let line, rev;
    if (dir === 0) { line = [board[0][i],board[1][i],board[2][i],board[3][i]]; rev=false; }
    else if (dir === 2) { line = [board[0][i],board[1][i],board[2][i],board[3][i]]; rev=true; }
    else if (dir === 1) { line = board[i].slice(); rev=false; }
    else { line = board[i].slice(); rev=true; }
    if (rev) line.reverse();
    const r = slideLeft(line);
    if (rev) r.result.reverse();
    gained += r.gained;
    if (dir === 0) for (let rr=0;rr<4;rr++) next[rr][i]=r.result[rr];
    else if (dir === 2) for (let rr=0;rr<4;rr++) next[3-rr][i]=r.result[rr];
    else if (dir === 1) for (let c=0;c<4;c++) next[i][c]=r.result[c];
    else for (let c=0;c<4;c++) next[i][3-c]=r.result[c];
  }
  let changed = false;
  for (let r=0;r<4 && !changed;r++) for (let c=0;c<4 && !changed;c++)
    if (board[r][c] !== next[r][c]) changed = true;
  return { board: next, changed, gained };
}

function hasMoves(board) {
  for (let r=0;r<4;r++) for (let c=0;c<4;c++) {
    if (board[r][c]===0) return true;
    if (c<3 && board[r][c]===board[r][c+1]) return true;
    if (r<3 && board[r][c]===board[r+1][c]) return true;
  }
  return false;
}

function addTile(board, rng) {
  const cells = emptyCells(board);
  if (!cells.length) return;
  const [r,c] = cells[Math.floor(rng()*cells.length)];
  board[r][c] = rng() < 0.9 ? 2 : 4;
}

function makeRng(seed) {
  let s = seed | 0;
  return function() {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function initialBoard(rng) {
  const b = [[0,0,0,0],[0,0,0,0],[0,0,0,0],[0,0,0,0]];
  addTile(b, rng); addTile(b, rng);
  return b;
}

// ============== Hand-crafted Evaluation (from index.html) ==============
const WEIGHT_PATTERNS = [
  [[15,14,13,12],[8,9,10,11],[7,6,5,4],[0,1,2,3]],
  [[10,8,7,5],[8,6,4,3],[7,4,2,1],[5,3,1,0]],
  [[12,9,6,3],[9,6,3,0],[6,3,0,0],[3,0,0,0]],
];

function evaluate(board) {
  let empty = 0, max = 0;
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) {
    if (board[r][c] === 0) empty++;
    if (board[r][c] > max) max = board[r][c];
  }

  // Structure score
  let structureScore = 0;
  for (const pattern of WEIGHT_PATTERNS) {
    let s = 0;
    for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) s += board[r][c] * pattern[r][c];
    structureScore += s;
  }
  structureScore /= WEIGHT_PATTERNS.length;

  // Smoothness
  let smoothness = 0;
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) {
    if (board[r][c] === 0) continue;
    if (c < 3 && board[r][c+1] !== 0) smoothness -= Math.abs(board[r][c] - board[r][c+1]);
    if (r < 3 && board[r+1][c] !== 0) smoothness -= Math.abs(board[r][c] - board[r+1][c]);
  }

  // Merges
  let merges = 0;
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) {
    if (c < 3 && board[r][c] === board[r][c+1] && board[r][c] > 0) merges++;
    if (r < 3 && board[r][c] === board[r+1][c] && board[r][c] > 0) merges++;
  }

  // Corner bonus
  let cornerBonus = 0;
  if (max > 0) {
    const corners = [[0,0],[0,3],[3,0],[3,3]];
    for (const [r,c] of corners) {
      if (board[r][c] === max) { cornerBonus = max * 10; break; }
    }
  }

  // Empty bonus
  const emptyBonus = empty === 0 ? 0 : Math.pow(empty, 1.5) * 50;

  return structureScore * 2.0 + emptyBonus + cornerBonus + smoothness * 8 + merges * 60 + Math.log2(max || 1) * 30;
}

// ============== Search ==============
function expectimax(board, depth, chance) {
  if (depth === 0 || !hasMoves(board)) return evaluate(board);

  if (!chance) {
    // Max node
    let best = -Infinity;
    for (let d = 0; d < 4; d++) {
      const { board: nb, changed, gained } = applyMove(board, d);
      if (changed) {
        const val = gained + expectimax(nb, depth - 1, true);
        if (val > best) best = val;
      }
    }
    return best === -Infinity ? evaluate(board) : best;
  } else {
    // Chance node
    const cells = emptyCells(board);
    if (!cells.length) return expectimax(board, depth - 1, false);
    const n = cells.length <= 4 ? cells.length : 4;
    const step = Math.floor(cells.length / n);
    let total = 0;
    for (let i = 0; i < n; i++) {
      const [r,c] = cells[i * step];
      const t2 = cloneBoard(board); t2[r][c] = 2;
      const t4 = cloneBoard(board); t4[r][c] = 4;
      total += 0.9 * expectimax(t2, depth - 1, false);
      total += 0.1 * expectimax(t4, depth - 1, false);
    }
    return total / n;
  }
}

function bestMove(board, depth) {
  let bestDir = -1, bestVal = -Infinity;
  // Move ordering: try moves that give more score first
  const moves = [];
  for (let d = 0; d < 4; d++) {
    const { board: nb, changed, gained } = applyMove(board, d);
    if (changed) moves.push({ d, nb, gained });
  }
  moves.sort((a, b) => b.gained - a.gained);

  let alpha = -Infinity;
  for (const { d, nb, gained } of moves) {
    const val = gained + expectimax(nb, depth - 1, true);
    if (val > bestVal) { bestVal = val; bestDir = d; }
    if (val > alpha) alpha = val;
  }
  return bestDir;
}

// ============== Game simulation ==============
function playGame(seed, depth) {
  const rng = makeRng(seed);
  const board = initialBoard(rng);
  let moves = 0;
  while (hasMoves(board) && moves < 3000) {
    const dir = bestMove(board, depth);
    if (dir < 0) break;
    const { board: nb } = applyMove(board, dir);
    board[0] = nb[0]; board[1] = nb[1]; board[2] = nb[2]; board[3] = nb[3];
    addTile(board, rng);
    moves++;
  }
  const maxTile = Math.max(...board.flat());
  return { maxTile, win: maxTile >= 2048, moves };
}

// ============== Benchmark ==============
function benchmarkDepth(depth, numGames) {
  const start = Date.now();
  const results = [];
  for (let i = 0; i < numGames; i++) {
    results.push(playGame(100000 + i, depth));
  }
  const elapsed = Date.now() - start;
  const wins = results.filter(r => r.win).length;
  const winRate = wins / numGames * 100;
  const avgMoves = results.reduce((a,b) => a+b.moves, 0) / numGames;
  const avgTime = elapsed / numGames;

  return { depth, winRate, wins, numGames, avgMoves, avgTime: avgTime.toFixed(1) };
}

// Run benchmarks
console.log('=== 2048 AI Benchmark ===\n');
const numGames = parseInt(process.argv[2]) || 50;

for (let depth = 1; depth <= 5; depth++) {
  const result = benchmarkDepth(depth, numGames);
  console.log(`Depth ${result.depth}: ${result.winRate.toFixed(1)}% win (${result.wins}/${result.numGames}) | Avg moves: ${result.avgMoves.toFixed(0)} | Time/game: ${result.avgTime}ms`);
}

// Also test performance (nodes/sec)
console.log('\n=== Performance Test ===');
const perfStart = Date.now();
let nodes = 0;
function countNodes(b, d, c) {
  nodes++;
  if (d === 0 || !hasMoves(b)) return evaluate(b);
  if (!c) {
    let best = -Infinity;
    for (let dir = 0; dir < 4; dir++) {
      const { board: nb, changed, gained } = applyMove(b, dir);
      if (changed) best = Math.max(best, gained + countNodes(nb, d-1, true));
    }
    return best === -Infinity ? evaluate(b) : best;
  } else {
    const cells = emptyCells(b);
    if (!cells.length) return countNodes(b, d-1, false);
    const n = cells.length <= 4 ? cells.length : 4;
    const step = Math.floor(cells.length / n);
    let total = 0;
    for (let i = 0; i < n; i++) {
      const [r,c] = cells[i*step];
      const t2 = cloneBoard(b); t2[r][c]=2;
      const t4 = cloneBoard(b); t4[r][c]=4;
      total += 0.9*countNodes(t2,d-1,false) + 0.1*countNodes(t4,d-1,false);
    }
    return total / n;
  }
}

const testBoard = [[2,4,2,4],[4,2,4,2],[2,4,2,4],[4,2,4,2]];
nodes = 0;
countNodes(testBoard, 3, false);
const perfElapsed = (Date.now() - perfStart);
console.log(`Depth 3 search: ${nodes.toLocaleString()} nodes in ${perfElapsed}ms = ${(nodes/perfElapsed*1000).toFixed(0)} nodes/sec`);

nodes = 0;
const perfStart2 = Date.now();
countNodes(testBoard, 4, false);
const perfElapsed2 = (Date.now() - perfStart2);
console.log(`Depth 4 search: ${nodes.toLocaleString()} nodes in ${perfElapsed2}ms = ${(nodes/perfElapsed2*1000).toFixed(0)} nodes/sec`);
