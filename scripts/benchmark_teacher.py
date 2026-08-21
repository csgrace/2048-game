#!/usr/bin/env python3
"""Measure the expectimax teacher on the same deterministic 2048 seed set."""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from train_policy_value import ROOT, add_tile, has_moves, initial_board, move, seeded_rng, teacher_move


def play_teacher(seed: int, depth: int, max_steps: int) -> dict:
    rng = seeded_rng(seed)
    board = initial_board(rng)
    score = steps = 0
    while has_moves(board) and steps < max_steps:
        direction = teacher_move(board, depth=depth)
        if direction < 0:
            break
        board, _, gained = move(board, direction)
        score += gained
        add_tile(board, rng)
        steps += 1
    max_tile = int(board.max())
    return {"score": score, "maxTile": max_tile, "steps": steps, "win": max_tile >= 2048}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--games", type=int, default=20)
    parser.add_argument("--seed", type=int, default=10_000)
    parser.add_argument("--depth", type=int, default=3)
    parser.add_argument("--max-steps", type=int, default=1500)
    parser.add_argument("--output", type=Path, default=ROOT / "js" / "ai-teacher-benchmark.json")
    args = parser.parse_args()
    if args.games <= 0:
        raise ValueError("--games must be positive")
    results = [play_teacher(args.seed + index, args.depth, args.max_steps) for index in range(args.games)]
    wins = sum(result["win"] for result in results)
    payload = {
        "teacher": "sampled-expectimax",
        "depth": args.depth,
        "seed": args.seed,
        "games": args.games,
        "wins": wins,
        "winRate": round(wins / args.games * 100, 2),
        "avgScore": round(sum(result["score"] for result in results) / args.games),
        "bestMaxTile": max(result["maxTile"] for result in results),
        "results": results,
    }
    args.output.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    print(json.dumps(payload, indent=2))


if __name__ == "__main__":
    main()
