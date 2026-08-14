# 2048 Game

[![SUSTech](https://img.shields.io/badge/SUSTech-CS109-blue)](https://www.sustech.edu.cn/)
[![Course](https://img.shields.io/badge/Course-Java%20Programming-green)]()
[![Platform](https://img.shields.io/badge/Platform-Java%20Swing%20%2B%20HTML5-orange)]()
[![Status](https://img.shields.io/badge/Status-Completed-brightgreen)]()

> **CS109 Java Programming - Course Project**
>
> A complete implementation of the 2048 number-puzzle game with multi-user support, per-grid leaderboards, save/load functionality, and an AI opponent powered by reinforcement learning.

---

## Overview

This project implements the classic **2048 number-puzzle game** as the capstone of CS109 Java Programming at SUSTech. The game features a Java Swing desktop client with PostgreSQL backend support, as well as a pure HTML5 web version deployable to any static host. An AI player powered by Expectimax search and neural network-based reinforcement learning is included for automated gameplay.

---

## Features

| Feature | Status | Description |
|---------|--------|-------------|
| **NxN Grids** | ✅ | 4×4 (Classic), 6×6 (Extended), 8×8 (Mega) with random seeding and custom tile colors |
| **Multi-user Login** | ✅ | User Mode ↔ Guest Mode with persistent accounts |
| **Save & Load** | ✅ | One slot per user per grid size; graceful handling of corrupt saves |
| **Gameplay** | ✅ | Keyboard and button controls, win/lose detection, 30-step undo |
| **GUI** | ✅ | Gradient backdrop with glass-morphism design, arrow pad controls |
| **Advanced** | ✅ | WebAudio sound, per-grid leaderboards, count-up/count-down timers |
| **AI Player** | ✅ | Expectimax search with neural network evaluation, self-play training |

---

## Game Rules

2048 is a single-player sliding block puzzle. The goal is to slide numbered tiles on a grid to combine them and create a tile with the number **2048**.

```
+------+------+------+------+
|  2   |  4   |  8   |  16  |
+------+------+------+------+
|  32  |  64  |  128 |  256 |
+------+------+------+------+
|  512 | 1024 |  2   |  4   |
+------+------+------+------+
|  8   |  16  |  32  |  64  |
+------+------+------+------+
```

- **Move**: Slide all tiles in one of four directions (up, down, left, right)
- **Merge**: When two tiles of the same number collide, they merge into their sum
- **Win**: Reach the 2048 tile
- **Lose**: No more valid moves available

---

## Architecture

### User Flow

```
┌─────────────┐      ┌──────────────┐      ┌──────────────┐      ┌────────────┐
│ Entry       │──┬──▶│ Auth (User)  │──┬──▶│ Settings     │─────▶│ Game       │
│ User / Guest│  │   │ login/regs   │  │   │ grid + timer │      │ NxN + sim  │
└─────────────┘  │   └──────────────┘  │   └──────────────┘      └────────────┘
                 │                      │
                 └──────────────────────┘  (Guest skips Auth)
```

### Key Design Decisions

- **CardLayout navigation**: Screen transitions managed via Java CardLayout for smooth flow
- **Per-grid isolation**: Leaderboards and saves are separated by grid size (4×4, 6×6, 8×8)
- **Database fallback**: PostgreSQL when available, transparent file-based persistence otherwise
- **Programmatic audio**: WebAudio API generates all sound effects without external files

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| **Frontend (Desktop)** | Java Swing with custom `paintComponent` rendering |
| **Frontend (Web)** | HTML5 + CSS3 + Vanilla JavaScript |
| **Backend** | PostgreSQL via JDBC |
| **Persistence** | File-based fallback (Java serialization) |
| **Audio** | WebAudio API (programmatic sound generation) |

---

## Repository Structure

```
2048-game-repo/
|-- src/
|   |-- Main.java                # Entry point
|   |-- model/
|   |   |-- User.java            # User entity (id, username)
|   |   |-- GameState.java       # Immutable game snapshot
|   |   |-- GameModel.java       # Core game logic (slide/merge/undo/win/lose)
|   |-- view/
|   |   |-- EntryPanel.java      # User / Guest selection
|   |   |-- AuthPanel.java       # Login / Register
|   |   |-- SettingsPanel.java   # Grid size + timer mode picker
|   |   |-- GamePanel.java       # Main game screen (NxN + timer)
|   |   |-- GameFrame.java       # CardLayout host window
|   |   |-- TileView.java        # Rounded-color tile renderer
|   |-- util/
|       |-- ColorMap.java        # Tile color definitions
|       |-- SoundManager.java    # Audio engine
|       |-- SaveManager.java     # File-based persistence
|       |-- DatabaseManager.java # PostgreSQL: users, scores, saves
|-- sql/init.sql                 # Database schema (v2 with grid_size column)
|-- js/
|   |-- ai-brain.js              # Neural network for AI evaluation
|   |-- ai-trainer-worker.js     # Self-play training worker
|   |-- ai-weights.json          # Trained model weights
|-- index.html                   # Static HTML5 version (GitHub Pages)
|-- data/                        # Runtime saves (auto-created)
|-- README.md
```

---

## Getting Started

### Desktop Version (Swing)

```bash
cd 2048-game-repo
javac -encoding UTF-8 -d out -sourcepath src src/Main.java
java -cp out Main
```

To use custom database connection:

```bash
java -Ddb.host=10.0.0.5 -Ddb.port=5432 -Ddb.name=cs109 \
     -Ddb.user=app -Ddb.pass=secret -cp out Main
```

### Web Version

Open `index.html` in any modern browser or deploy to GitHub Pages. No server required.

**Live demo:** [csgrace.github.io/2048-game](https://csgrace.github.io/2048-game)

### Database Setup (Optional)

```bash
# Create database
psql -U postgres -c "CREATE DATABASE game2048;"

# Apply schema
psql -U postgres -d game2048 -f sql/init.sql
```

---

## Results

- [x] All grid sizes (4×4, 6×6, 8×8) fully functional
- [x] Multi-user registration and login with persistent storage
- [x] Save/load system with per-user, per-grid isolation
- [x] Undo functionality (30-step history)
- [x] Per-grid leaderboards with score tracking
- [x] Count-up and count-down timer modes
- [x] WebAudio sound effects without external files
- [x] AI player capable of reaching 2048 tile
- [x] HTML5 version deployed to GitHub Pages

---

## Highlights

| Feature | Description |
|---------|-------------|
| **NxN Support** | 4×4, 6×6, 8×8 grid sizes with independent game states |
| **Multi-user** | User registration, login, and persistent profiles |
| **Leaderboards** | Separate score tracking per grid size |
| **Undo** | 30-step move history with full state restoration |
| **Timers** | Count-up (stopwatch) and count-down (60s/2min/5min) modes |
| **AI Player** | Expectimax search + neural network for intelligent gameplay |
| **Cross-platform** | Desktop (Swing) and web (HTML5) versions |
