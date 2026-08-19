#!/usr/bin/env python3
"""Reproducible policy-value training and validation for the web 2048 AI."""
from __future__ import annotations

import argparse
import json
import math
import random
import time
from pathlib import Path
from typing import Iterable

import numpy as np
import torch
from torch import nn
from torch.nn import functional as F

ROOT = Path(__file__).resolve().parents[1]
WEIGHTS_PATH = ROOT / "js" / "ai-weights.json"
PROGRESS_PATH = ROOT / "js" / "ai-training-progress.json"
CHECKPOINT_PATH = ROOT / "js" / "ai-best-checkpoint.json"
DIRECTIONS = ("up", "left", "down", "right")
SNAKE = np.array([[16, 15, 14, 13], [9, 10, 11, 12], [8, 7, 6, 5], [1, 2, 3, 4]], dtype=np.float32)


def seeded_rng(seed: int) -> random.Random:
    return random.Random(seed)


def empty_cells(board: np.ndarray) -> list[tuple[int, int]]:
    return [(r, c) for r in range(4) for c in range(4) if board[r, c] == 0]


def slide(line: Iterable[int]) -> tuple[list[int], int]:
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


def move(board: np.ndarray, direction: int) -> tuple[np.ndarray, bool, int]:
    """Apply the browser's direction order: up, left, down, right."""
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


def encode(board: np.ndarray) -> np.ndarray:
    """Same 16-channel, cell-major one-hot encoding consumed by js/ai-brain.js."""
    encoded = np.zeros((4, 4, 16), dtype=np.float32)
    for r in range(4):
        for c in range(4):
            value = int(board[r, c])
            channel = min(int(math.log2(value)), 15) if value else 0
            encoded[r, c, channel] = 1.0
    return encoded.reshape(-1)


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


def search(board: np.ndarray, depth: int, chance: bool) -> float:
    if depth <= 0:
        return heuristic(board)
    if not chance:
        candidates = [gained + search(next_board, depth - 1, True) for direction in range(4)
                      for next_board, changed, gained in [move(board, direction)] if changed]
        return max(candidates, default=-100000.0)
    cells = sampled_cells(board)
    if not cells:
        return search(board, depth - 1, False)
    total = 0.0
    for r, c in cells:
        two, four = board.copy(), board.copy()
        two[r, c], four[r, c] = 2, 4
        total += 0.9 * search(two, depth - 1, False) + 0.1 * search(four, depth - 1, False)
    return total / len(cells)


def teacher_move(board: np.ndarray, depth: int = 2) -> int:
    scored = [(gained + search(next_board, depth, True), direction) for direction in range(4)
              for next_board, changed, gained in [move(board, direction)] if changed]
    return max(scored, default=(-float("inf"), -1))[1]


class PolicyValueNet(nn.Module):
    def __init__(self) -> None:
        super().__init__()
        self.l1 = nn.Linear(256, 96)
        self.l2 = nn.Linear(96, 48)
        self.l3 = nn.Linear(48, 16)
        self.l4 = nn.Linear(16, 1)
        self.policy = nn.Linear(16, 4)

    def forward(self, x: torch.Tensor) -> tuple[torch.Tensor, torch.Tensor]:
        x = F.leaky_relu(self.l1(x), negative_slope=0.05)
        x = F.leaky_relu(self.l2(x), negative_slope=0.05)
        trunk = F.leaky_relu(self.l3(x), negative_slope=0.05)
        return torch.tanh(self.l4(trunk)).squeeze(-1), self.policy(trunk)


def sample_teacher_data(games: int, seed: int) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    rng = seeded_rng(seed)
    states, policies, values = [], [], []
    for _ in range(games):
        board = initial_board(rng)
        steps = 0
        while has_moves(board) and steps < 300:
            action = teacher_move(board)
            if action < 0:
                break
            states.append(encode(board))
            policies.append(action)
            # Bounded, scale-free target; no arbitrary multiplication during inference.
            values.append(math.tanh(heuristic(board) / 800.0))
            board, _, _ = move(board, action)
            add_tile(board, rng)
            steps += 1
    return np.asarray(states), np.asarray(policies), np.asarray(values, dtype=np.float32)


def model_outputs(model: PolicyValueNet, board: np.ndarray, device: torch.device) -> tuple[float, np.ndarray]:
    with torch.no_grad():
        value, logits = model(torch.from_numpy(encode(board)).to(device).unsqueeze(0))
    return float(value.item()), logits.squeeze(0).detach().cpu().numpy()


def model_search(model: PolicyValueNet, board: np.ndarray, depth: int, chance: bool, device: torch.device) -> float:
    if depth <= 0:
        value, _ = model_outputs(model, board, device)
        return heuristic(board) + value * 120
    if not chance:
        _, logits = model_outputs(model, board, device)
        candidates = [gained + logits[direction] * 12 + model_search(model, next_board, depth - 1, True, device)
                      for direction in range(4) for next_board, changed, gained in [move(board, direction)] if changed]
        return max(candidates, default=-100000.0)
    cells = sampled_cells(board)
    if not cells:
        return model_search(model, board, depth - 1, False, device)
    total = 0.0
    for r, c in cells:
        two, four = board.copy(), board.copy()
        two[r, c], four[r, c] = 2, 4
        total += 0.9 * model_search(model, two, depth - 1, False, device) + 0.1 * model_search(model, four, depth - 1, False, device)
    return total / len(cells)


def play_game(model: PolicyValueNet, seed: int, device: torch.device) -> dict:
    rng = seeded_rng(seed)
    board = initial_board(rng)
    score = steps = 0
    model.eval()
    while has_moves(board) and steps < 5000:
        _, logits = model_outputs(model, board, device)
        legal = [(gained + logits[direction] * 12 + model_search(model, next_board, 3, True, device), direction, next_board, gained)
                 for direction in range(4) for next_board, changed, gained in [move(board, direction)] if changed]
        if not legal:
            break
        _, _, board, gained = max(legal)
        score += gained
        add_tile(board, rng)
        steps += 1
    max_tile = int(board.max())
    return {"score": score, "maxTile": max_tile, "steps": steps, "win": max_tile >= 2048}


def validate(model: PolicyValueNet, seeds: list[int], device: torch.device) -> dict:
    results = [play_game(model, seed, device) for seed in seeds]
    return {
        "games": len(results), "wins": sum(result["win"] for result in results),
        "winRate": round(sum(result["win"] for result in results) / len(results) * 100, 2),
        "avgScore": round(sum(result["score"] for result in results) / len(results)),
        "bestMaxTile": max(result["maxTile"] for result in results), "seed": seeds[0],
    }


def js_weights(model: PolicyValueNet, version: int, metrics: dict, history: list[dict]) -> dict:
    state = model.state_dict()
    def array(key: str) -> list[float]:
        return state[key].detach().cpu().numpy().reshape(-1).astype(float).tolist()
    return {
        "format": "policy-value-v1", "version": version, "normalization": "tanh(heuristic/800)",
        "architecture": "256-96-48-16-(value:1,policy:4)", "description": "Reproducible normalized policy-value model",
        "l1W": array("l1.weight"), "l1b": array("l1.bias"), "l2W": array("l2.weight"), "l2b": array("l2.bias"),
        "l3W": array("l3.weight"), "l3b": array("l3.bias"), "l4W": array("l4.weight"), "l4b": array("l4.bias"),
        "policyW": array("policy.weight"), "policyB": array("policy.bias"), "validation": metrics, "history": history,
        "bestMaxTile": metrics["bestMaxTile"], "avgScore": metrics["avgScore"],
    }


def save_json(path: Path, payload: dict) -> None:
    path.write_text(json.dumps(payload, indent=2), encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--games", type=int, default=250)
    parser.add_argument("--epochs", type=int, default=8)
    parser.add_argument("--seed", type=int, default=2048)
    parser.add_argument("--validation-games", type=int, default=50)
    args = parser.parse_args()
    random.seed(args.seed); np.random.seed(args.seed); torch.manual_seed(args.seed)
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    model = PolicyValueNet().to(device)
    optimizer = torch.optim.AdamW(model.parameters(), lr=2e-3, weight_decay=1e-4)
    scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=max(args.epochs, 1), eta_min=2e-4)
    states, policies, values = sample_teacher_data(args.games, args.seed)
    if len(states) == 0:
        raise RuntimeError("Teacher produced no training states")
    x = torch.from_numpy(states).to(device); y_policy = torch.from_numpy(policies).to(device); y_value = torch.from_numpy(values).to(device)
    history: list[dict] = []
    best_metrics: dict | None = None
    best_state = None
    validation_seeds = list(range(10_000, 10_000 + args.validation_games))
    started = time.time()
    for epoch in range(1, args.epochs + 1):
        model.train(); permutation = torch.randperm(len(x), device=device); losses = []
        for start in range(0, len(x), 128):
            indexes = permutation[start:start + 128]
            predicted_value, logits = model(x[indexes])
            value_loss = F.huber_loss(predicted_value, y_value[indexes])
            policy_loss = F.cross_entropy(logits, y_policy[indexes])
            loss = value_loss + policy_loss
            optimizer.zero_grad(); loss.backward(); torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0); optimizer.step()
            losses.append(float(loss.item()))
        scheduler.step()
        metrics = validate(model, validation_seeds, device)
        point = {"epoch": epoch, "game": epoch, "loss": round(float(np.mean(losses)), 6), "learningRate": optimizer.param_groups[0]["lr"], "validation": metrics}
        history.append(point)
        save_json(PROGRESS_PATH, {"active": True, "phase": "training", "version": 1, "epoch": epoch, "totalEpochs": args.epochs, "history": history, "validation": metrics})
        candidate = (metrics["winRate"], metrics["avgScore"], metrics["bestMaxTile"])
        incumbent = (-1, -1, -1) if best_metrics is None else (best_metrics["winRate"], best_metrics["avgScore"], best_metrics["bestMaxTile"])
        if candidate > incumbent:
            best_metrics = metrics
            best_state = {key: value.detach().cpu().clone() for key, value in model.state_dict().items()}
            save_json(CHECKPOINT_PATH, js_weights(model, 1, metrics, history))
        print(f"epoch {epoch}/{args.epochs} loss={point['loss']:.6f} validation={metrics['winRate']}% avg={metrics['avgScore']}")
    assert best_state is not None and best_metrics is not None
    model.load_state_dict(best_state)
    weights = js_weights(model, 1, best_metrics, history)
    weights["trainTime"] = f"{time.time() - started:.1f}s"
    save_json(WEIGHTS_PATH, weights)
    save_json(PROGRESS_PATH, {"active": False, "phase": "complete", "version": 1, "history": history, "validation": best_metrics, "message": "v1 training complete; best fixed-seed checkpoint published."})
    print(json.dumps(best_metrics))


if __name__ == "__main__":
    main()
