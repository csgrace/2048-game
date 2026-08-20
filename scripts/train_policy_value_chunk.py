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
BACKEND_STATUS_PATH = ROOT / "js" / "ai-backend-status.json"
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


def candidate_payload(model: PolicyValueNet, version: int, completed: int, history: list[dict], validation: dict | None) -> dict:
    metadata = validation or {"games": 0, "wins": 0, "winRate": 0, "avgScore": 0, "bestMaxTile": 0, "seed": 10000}
    payload = js_weights(model, version, metadata, history)
    payload.update({
        "status": "candidate",
        "trainingGames": completed,
        "chunkSize": 10,
        "description": f"Resumable v{version} candidate; persisted every 10 teacher games before the next chunk.",
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
    parser.add_argument("--version", type=int, default=1)
    parser.add_argument("--initialize-from-published", action="store_true", help="Start this version from the published checkpoint instead of an older candidate.")
    parser.add_argument("--initialize-only", action="store_true", help="Persist an initialized candidate and queued status without training a chunk.")
    args = parser.parse_args()
    if args.games != 10:
        raise ValueError("This checkpoint workflow is intentionally fixed at 10 games per chunk.")

    random.seed(args.seed); np.random.seed(args.seed); torch.manual_seed(args.seed)
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    prior = read_json(CANDIDATE_PATH, {})
    starting_from_published = args.initialize_from_published and int(prior.get("version", 0)) != args.version
    if starting_from_published:
        prior = read_json(WEIGHTS_PATH, {})
    completed = 0 if starting_from_published else int(prior.get("trainingGames", 0))
    history: list[dict] = [] if starting_from_published else list(prior.get("history", []))
    model = load_model(prior, device)
    if args.initialize_only:
        write_json(CANDIDATE_PATH, candidate_payload(model, args.version, 0, [], None))
        write_json(PROGRESS_PATH, {"active": True, "phase": "queued", "version": args.version, "completedGames": 0, "targetGames": args.target_games, "chunkSize": 10, "history": [], "validation": None, "message": f"v{args.version} queued from the published v{prior.get('version', 'unknown')} checkpoint."})
        write_json(BACKEND_STATUS_PATH, {"pid": 0, "version": args.version, "active": True, "phase": "queued", "trainProgress": f"0/{args.target_games}", "message": f"v{args.version} will continue from the published checkpoint."})
        print(f"Initialized v{args.version} from published checkpoint.")
        return
    if completed >= args.target_games:
        write_json(PROGRESS_PATH, {"active": False, "phase": "complete", "version": args.version, "completedGames": completed, "targetGames": args.target_games, "history": history, "message": f"All v{args.version} chunks have already completed."})
        print("No training needed; target already reached.")
        return

    games = min(args.games, args.target_games - completed)
    optimizer = torch.optim.AdamW(model.parameters(), lr=0.001, weight_decay=1e-4)
    chunk_started = time.time()
    states, policies, values, game_metrics = sample_teacher_data(games, args.seed + completed)
    teacher_seconds = time.time() - chunk_started
    x = torch.from_numpy(states).to(device)
    y_policy = torch.from_numpy(policies).to(device)
    y_value = torch.from_numpy(values).to(device)
    optimization_started = time.time()
    model.train()
    policy_losses: list[float] = []
    value_losses: list[float] = []
    for _ in range(args.epochs):
        permutation = torch.randperm(len(x), device=device)
        for start in range(0, len(x), 128):
            indexes = permutation[start:start + 128]
            predicted_value, logits = model(x[indexes])
            value_loss = F.huber_loss(predicted_value, y_value[indexes])
            policy_loss = F.cross_entropy(logits, y_policy[indexes])
            loss = value_loss + policy_loss
            optimizer.zero_grad(); loss.backward(); torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0); optimizer.step()
            value_losses.append(float(value_loss.item()))
            policy_losses.append(float(policy_loss.item()))

    completed += games
    full_validation = completed % args.full_validation_every == 0 or completed == args.target_games
    validation = validate(model, list(range(10_000, 10_000 + args.validation_games)), device) if full_validation else None
    point = {
        "chunk": len(history) + 1, "game": completed, "chunkGames": games,
        "loss": round(float(np.mean(value_losses) + np.mean(policy_losses)), 6),
        "policyLoss": round(float(np.mean(policy_losses)), 6),
        "valueLoss": round(float(np.mean(value_losses)), 6),
        "maxTile": max(metric["maxTile"] for metric in game_metrics),
        "avgScore": round(float(np.mean([metric["score"] for metric in game_metrics]))),
        "avgSteps": round(float(np.mean([metric["steps"] for metric in game_metrics]))),
        "teacherSeconds": round(teacher_seconds, 1),
        "optimizationSeconds": round(time.time() - optimization_started, 1),
        "elapsedSeconds": round(time.time() - chunk_started, 1),
        "validation": validation, "fullValidation": full_validation,
    }
    history.append(point)
    candidate = candidate_payload(model, args.version, completed, history, validation)
    write_json(CANDIDATE_PATH, candidate)
    progress = {
        "active": completed < args.target_games, "phase": "checkpoint", "version": args.version,
        "completedGames": completed, "targetGames": args.target_games, "chunkSize": 10,
        "history": history, "validation": validation,
        "message": f"Checkpoint saved after {completed}/{args.target_games} teacher games."
    }
    write_json(PROGRESS_PATH, progress)
    write_json(BACKEND_STATUS_PATH, {
        "pid": 0, "version": args.version, "active": completed < args.target_games,
        "phase": "training" if completed < args.target_games else "complete",
        "trainProgress": f"{completed}/{args.target_games}", "loss": point["loss"],
        "bestMaxTile": point["maxTile"], "avgScore": point["avgScore"],
        "lastUpdate": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "message": f"v{args.version} checkpoint {completed}/{args.target_games}; each checkpoint contains 10 teacher games."
    })

    # The visible model changes only after a full fixed-seed validation beats the published score.
    if validation:
        published = read_json(WEIGHTS_PATH, {})
        previous = published.get("validation", {})
        candidate_score = (validation["winRate"], validation["avgScore"], validation["bestMaxTile"])
        previous_score = (previous.get("winRate", -1), previous.get("avgScore", -1), previous.get("bestMaxTile", -1))
        if candidate_score > previous_score:
            published_weights = candidate_payload(model, args.version, completed, history, validation)
            published_weights["status"] = "published"
            published_weights["description"] = f"Best v{args.version} checkpoint selected by full fixed-seed validation."
            write_json(WEIGHTS_PATH, published_weights)
            write_json(CHECKPOINT_PATH, published_weights)
            print(f"Published improved fixed-seed checkpoint at {completed} games.")
    print(json.dumps({"completedGames": completed, "targetGames": args.target_games, "fullValidation": full_validation, "elapsedSeconds": point["elapsedSeconds"]}))


if __name__ == "__main__":
    main()
