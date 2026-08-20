#!/usr/bin/env python3
"""Fixed-seed validator for the published policy-value web weights."""
from __future__ import annotations

import argparse
import json
from pathlib import Path
from time import perf_counter

import torch

from train_policy_value import PolicyValueNet, ROOT, WEIGHTS_PATH, play_game


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--games", type=int, default=50)
    parser.add_argument("--seed", type=int, default=10_000)
    args = parser.parse_args()
    weights = json.loads(WEIGHTS_PATH.read_text(encoding="utf-8"))
    if weights.get("format") != "policy-value-v1":
        raise RuntimeError("Expected a policy-value-v1 ai-weights.json")
    model = PolicyValueNet()
    mapping = {
        "l1.weight": "l1W", "l1.bias": "l1b", "l2.weight": "l2W", "l2.bias": "l2b",
        "l3.weight": "l3W", "l3.bias": "l3b", "l4.weight": "l4W", "l4.bias": "l4b",
        "policy.weight": "policyW", "policy.bias": "policyB",
    }
    target = model.state_dict()
    for key, source in mapping.items():
        target[key] = torch.tensor(weights[source], dtype=torch.float32).reshape(target[key].shape)
    model.load_state_dict(target)
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    model.to(device)
    results = []
    for index in range(args.games):
        started_at = perf_counter()
        result = play_game(model, args.seed + index, device)
        result.update({
            "game": index + 1,
            "result": "win" if result.pop("win") else "lose",
            "duration": round((perf_counter() - started_at) * 1000),
        })
        results.append(result)
    wins = sum(result["result"] == "win" for result in results)
    payload = {
        "active": False, "phase": "validation", "version": weights["version"], "seed": args.seed,
        "totalGames": args.games, "completedGames": args.games, "wins": wins, "fails": args.games - wins,
        "winRate": round(wins / args.games * 100, 2),
        "avgScore": round(sum(result["score"] for result in results) / args.games),
        "bestMaxTile": max(result["maxTile"] for result in results), "results": results,
    }
    (ROOT / "js" / "ai-playtest-progress.json").write_text(json.dumps(payload, indent=2), encoding="utf-8")
    print(json.dumps(payload, indent=2))


if __name__ == "__main__":
    main()
