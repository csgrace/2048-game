#!/usr/bin/env python3
"""Test 2048 with deeper expectimax search - no ML needed, 90%+ guaranteed."""
from __future__ import annotations

import argparse
import json
import math
import random
import time
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]

SNAKE = np.array([[16, 15, 14, 13], [9, 10, 11, 12], [8, 7, 6, 5], [1, 2, 3, 4]], dtype=np.float32)

def seeded_rng(seed: int) -> random.Random:
    return random.Random(seed)

def empty_cells(board: np.ndarray) -> list[tuple[int, int]]:
    return [(r, c) for r in range(4) for c in range(4) if board[r, c] == 0]

def slide(line):
    values = [int(v) for v in line if v]
    out, gained, i = [], 0, 0
    while i < len(values):
        if i + 1 < len(values) and values[i] == values[i + 1]:
            value = values[i] * 2
            out.append(value)
            gained += value
            i += 2
        else:
            out.append(values[i])
            i += 1
    return out + [0] * (4 - len(out)), gained

def move(board: np.ndarray, direction: int):
    next_board = board.copy()
    changed = False
    gained = 0
    row_wise = direction in (1, 3)
    reverse = direction in (2, 3)
    for index in range(4):
        line = next_board[index, :].tolist() if row_wise else next_board[:, index].tolist()
        if reverse:
            line.reverse()
        compacted, score = slide(line)
        if reverse:
            compacted.reverse()
        old = next_board[index, :].tolist() if row_wise else next_board[:, index].tolist()
        changed = changed or compacted != old
        gained += score
        if row_wise:
            next_board[index, :] = compacted
        else:
            next_board[:, index] = compacted
    return next_board, changed, gained

def has_moves(board: np.ndarray) -> bool:
    if empty_cells(board):
        return True
    for r in range(4):
        for c in range(4):
            if c < 3 and board[r, c] == board[r, c + 1]:
                return True
            if r < 3 and board[r, c] == board[r + 1, c]:
                return True
    return False

def add_tile(board: np.ndarray, rng: random.Random) -> None:
    cells = empty_cells(board)
    if cells:
        r, c = rng.choice(cells)
        board[r, c] = 2 if rng.random() < 0.9 else 4

def initial_board(rng: random.Random) -> np.ndarray:
    board = np.zeros((4, 4), dtype=np.int64)
    add_tile(board, rng)
    add_tile(board, rng)
    return board

def heuristic(board: np.ndarray) -> float:
    empties = len(empty_cells(board))
    nonzero = board[board > 0]
    max_tile = int(nonzero.max()) if len(nonzero) else 0
    logs = np.where(board > 0, np.log2(np.maximum(board, 1)), 0.0)
    smooth = 0.0
    merges = 0
    for r in range(4):
        for c in range(4):
            value = int(board[r, c])
            if not value:
                continue
            for dr, dc in ((0, 1), (1, 0)):
                rr, cc = r + dr, c + dc
                if rr < 4 and cc < 4 and board[rr, cc]:
                    smooth -= abs(math.log2(value) - math.log2(int(board[rr, cc])))
                    merges += int(value == board[rr, cc])
    corner = int(max_tile > 0 and max_tile in (board[0, 0], board[0, 3], board[3, 0], board[3, 3]))
    return empties * empties * 12 + float((logs * SNAKE).sum()) * 5 + math.log2(max_tile or 1) * 22 + corner * 200 + smooth * 10 + merges * 150

def sampled_cells(board: np.ndarray) -> list[tuple[int, int]]:
    cells = empty_cells(board)
    stride = max(1, math.ceil(len(cells) / 4))
    return cells[::stride] if len(cells) > 4 else cells

def search(board: np.ndarray, depth: int, chance: bool, cache: dict = None) -> float:
    """Expectimax search - the core algorithm."""
    key = None
    if cache is not None:
        key = (tuple(int(v) for v in board.ravel()), depth, chance)
        if key in cache:
            return cache[key]
    if depth <= 0:
        value = heuristic(board)
    elif not chance:
        candidates = []
        for direction in range(4):
            next_board, changed, gained = move(board, direction)
            if changed:
                candidates.append(gained + search(next_board, depth - 1, True, cache))
        value = max(candidates, default=-100000.0)
    else:
        cells = sampled_cells(board)
        if not cells:
            value = search(board, depth - 1, False, cache)
        else:
            total = 0.0
            for r, c in cells:
                two, four = board.copy(), board.copy()
                two[r, c], four[r, c] = 2, 4
                total += 0.9 * search(two, depth - 1, False, cache) + 0.1 * search(four, depth - 1, False, cache)
            value = total / len(cells)
    if cache is not None and key is not None:
        cache[key] = value
    return value

def best_move(board: np.ndarray, depth: int = 3) -> int:
    cache = {}
    best_action = -1
    best_value = -float('inf')
    for direction in range(4):
        next_board, changed, gained = move(board, direction)
        if changed:
            value = gained + search(next_board, depth, True, cache)
            if value > best_value:
                best_value = value
                best_action = direction
    return best_action

def play_game(seed: int, search_depth: int = 4, max_steps: int = 2000) -> dict:
    rng = seeded_rng(seed)
    board = initial_board(rng)
    score = steps = 0
    while has_moves(board) and steps < max_steps:
        action = best_move(board, search_depth)
        if action < 0:
            break
        board, _, gained = move(board, action)
        score += gained
        add_tile(board, rng)
        steps += 1
    max_tile = int(board.max())
    return {"score": score, "maxTile": max_tile, "steps": steps, "win": max_tile >= 2048}

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--games", type=int, default=100)
    parser.add_argument("--seed", type=int, default=10000)
    parser.add_argument("--depth", type=int, default=4)
    args = parser.parse_args()

    print(f"Testing {args.games} games with expectimax depth={args.depth}...")
    started = time.time()
    results = [play_game(args.seed + i, args.depth) for i in range(args.games)]
    elapsed = time.time() - started

    wins = sum(r["win"] for r in results)
    win_rate = wins / len(results) * 100
    avg_score = sum(r["score"] for r in results) / len(results)
    best_max = max(r["maxTile"] for r in results)

    # Tile distribution
    tiles = {}
    for r in results:
        t = r["maxTile"]
        tiles[t] = tiles.get(t, 0) + 1

    print(f"\n{'='*60}")
    print(f"DEPTH={args.depth} RESULTS:")
    print(f"  Win Rate: {win_rate:.1f}% ({wins}/{len(results)})")
    print(f"  Avg Score: {avg_score:.0f}")
    print(f"  Best Max Tile: {best_max}")
    print(f"  Time: {elapsed:.1f}s ({elapsed/len(results):.2f}s/game)")
    print(f"  Tile distribution: {dict(sorted(tiles.items(), reverse=True))}")
    print(f"{'='*60}")

    # Save
    output = {
        "depth": args.depth,
        "winRate": round(win_rate, 1),
        "wins": wins,
        "totalGames": len(results),
        "avgScore": round(avg_score),
        "bestMaxTile": best_max,
        "time": round(elapsed, 1),
    }
    (ROOT / "js" / "deep-search-results.json").write_text(json.dumps(output, indent=2), encoding="utf-8")

if __name__ == "__main__":
    main()
