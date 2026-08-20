#!/usr/bin/env python3
"""One resumable 10-game policy-value training chunk for GitHub Actions."""
from __future__ import annotations

import argparse
import json
import random
import time
from pathlib import Path

import numpy as np
import torch
from torch.nn import functional as F

from train_policy_value import (
    CHECKPOINT_PATH,
    PROGRESS_PATH,
    ROOT,
    WEIGHTS_PATH,
    PolicyValueNet,
    js_weights,
    sample_teacher_data,
    validate,
)

CANDIDATE_PATH = ROOT / "js" / "ai-training-candidate.json"
STATE_KEYS = {
    "l1.weight": "l1W", "l1.bias": "l1b", "l2.weight": "l2W", "l2.bias": "l2b",
    "l3.weight": "l3W", "l3.bias": "l3b", "l4.weight": "l4W", "l4.bias": "l4b",
    "policy.weight": "policyW", "policy.bias": "policyB",
}


def read_json(path: Path, fallback: dict) -> dict:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return fallback


def write_json(path: Path, payload: dict) -> None:
    path.write_text(json.dumps(payload, indent=2), encoding="utf-8")


def load_model(payload: dict, device: torch.device) -> PolicyValueNet:
    model = PolicyValueNet().to(device)
    if not payload.get("l1W"):
        return model
    state = model.state_dict()
    try:
        for target, source in STATE_KEYS.items():
            state[target] = torch.tensor(payload[source], dtype=torch.float32).reshape(state[target].shape)
        model.load_state_dict(state)
    except (KeyError, ValueError, RuntimeError):
        # A malformed candidate is never allowed to block a clean restart.
        pass
    return model


def candidate_payload(model: PolicyValueNet, completed: int, history: list[dict], validation: dict | None) -> dict:
    metadata = validation or {"games": 0, "wins": 0, "winRate": 0, "avgScore": 0, "bestMaxTile": 0, "seed": 10000}
    payload = js_weights(model, 1, metadata, history)
    payload.update({
        "status": "candidate",
        "trainingGames": completed,
        "chunkSize": 10,
        "description": "Resumable v1 candidate; persisted every 10 teacher games before the next chunk.",
    })
    return payload


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--games", type=int, default=10, help="Teacher games in this checkpoint chunk")
    parser.add_argument("--target-games", type=int, default=250)
    parser.add_argument("--epochs", type=int, default=2, help="Gradient epochs over this chunk's fresh teacher states")
    parser.add_argument("--seed", type=int, default=2048)
    parser.add_argument("--full-validation-every", type=int, default=50)
    parser.add_argument("--validation-games", type=int, default=50)
    args = parser.parse_args()
    if args.games != 10:
        raise ValueError("This checkpoint workflow is intentionally fixed at 10 games per chunk.")

    random.seed(args.seed); np.random.seed(args.seed); torch.manual_seed(args.seed)
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    prior = read_json(CANDIDATE_PATH, {})
    completed = int(prior.get("trainingGames", 0))
    history: list[dict] = list(prior.get("history", []))
    if completed >= args.target_games:
        write_json(PROGRESS_PATH, {"active": False, "phase": "complete", "version": 1, "completedGames": completed, "targetGames": args.target_games, "history": history, "message": "All v1 chunks have already completed."})
        print("No training needed; target already reached.")
        return

    games = min(args.games, args.target_games - completed)
    model = load_model(prior, device)
    optimizer = torch.optim.AdamW(model.parameters(), lr=0.001, weight_decay=1e-4)
    states, policies, values = sample_teacher_data(games, args.seed + completed)
    x = torch.from_numpy(states).to(device)
    y_policy = torch.from_numpy(policies).to(device)
    y_value = torch.from_numpy(values).to(device)
    started = time.time()
    model.train()
    losses: list[float] = []
    for _ in range(args.epochs):
        permutation = torch.randperm(len(x), device=device)
        for start in range(0, len(x), 128):
            indexes = permutation[start:start + 128]
            predicted_value, logits = model(x[indexes])
            loss = F.huber_loss(predicted_value, y_value[indexes]) + F.cross_entropy(logits, y_policy[indexes])
            optimizer.zero_grad(); loss.backward(); torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0); optimizer.step()
            losses.append(float(loss.item()))

    completed += games
    full_validation = completed % args.full_validation_every == 0 or completed == args.target_games
    validation = validate(model, list(range(10_000, 10_000 + args.validation_games)), device) if full_validation else None
    point = {
        "chunk": len(history) + 1, "game": completed, "chunkGames": games,
        "loss": round(float(np.mean(losses)), 6), "elapsedSeconds": round(time.time() - started, 1),
        "validation": validation, "fullValidation": full_validation,
    }
    history.append(point)
    candidate = candidate_payload(model, completed, history, validation)
    write_json(CANDIDATE_PATH, candidate)
    progress = {
        "active": completed < args.target_games, "phase": "checkpoint", "version": 1,
        "completedGames": completed, "targetGames": args.target_games, "chunkSize": 10,
        "history": history, "validation": validation,
        "message": f"Checkpoint saved after {completed}/{args.target_games} teacher games."
    }
    write_json(PROGRESS_PATH, progress)

    # The visible model changes only after a full fixed-seed validation beats the published score.
    if validation:
        published = read_json(WEIGHTS_PATH, {})
        previous = published.get("validation", {})
        candidate_score = (validation["winRate"], validation["avgScore"], validation["bestMaxTile"])
        previous_score = (previous.get("winRate", -1), previous.get("avgScore", -1), previous.get("bestMaxTile", -1))
        if candidate_score > previous_score:
            published_weights = candidate_payload(model, completed, history, validation)
            published_weights["status"] = "published"
            published_weights["description"] = "Best v1 checkpoint selected by full fixed-seed validation."
            write_json(WEIGHTS_PATH, published_weights)
            write_json(CHECKPOINT_PATH, published_weights)
            print(f"Published improved fixed-seed checkpoint at {completed} games.")
    print(json.dumps({"completedGames": completed, "targetGames": args.target_games, "fullValidation": full_validation, "elapsedSeconds": point["elapsedSeconds"]}))


if __name__ == "__main__":
    main()
