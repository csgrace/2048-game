# 2048 – CS109 Spring 2026 Project

A complete implementation of the 2048 number-puzzle game in **Java (Swing)**
with optional **PostgreSQL** backing for user accounts, per-grid leaderboards,
and per-grid saves.  A pure-HTML5 front-end is also provided for deployment to
GitHub Pages / any static host.

---

## Features

| Task | Status | Notes |
|------|--------|-------|
| **1 – Game init & NxN grids** | ✅ | 4×4 (Classic), 6×6 (Extended), 8×8 (Mega); restart, random seeding, colours per tile |
| **2 – Multi-user login** | ✅ | `User Mode` ↔ `Guest Mode`; users persist across launches |
| **3 – Save & load** | ✅ | One slot per user per grid size (Guest Mode has **no save/load**); corrupt saves fail gracefully |
| **4 – Gameplay** | ✅ | Keyboard **and** button controls, win/lose detection, undo (30-step) |
| **5 – Swing GUI** | ✅ | Gradient backdrop + glass-morphism cards, arrow pad |
| **6 – Advanced** | ✅ | WebAudio sound, **per-grid leaderboards**, **count-up / count-down timers**, settings panel |

Additional niceties:

* Self-connecting **PostgreSQL** layer (`DatabaseManager`) – plug in your
  connection details via system properties (`-Ddb.host=…`).
* Fallback to file-based persistence when no database is available.
* User flow: `Entry Screen → Auth Screen (User) → Settings Screen → Game Screen`
  driven by `CardLayout`.
* Leaderboard **separate per grid size** — 4×4, 6×6, and 8×8 each have their own
  score board.
* Two timer modes: **count-up** (stopwatch) and **count-down** (60s / 2 min / 5 min).
* Sound generated programmatically – no external audio files required.

---

## Project layout

```
2048-game-repo/
├── src/
│   ├── Main.java                # entry point
│   ├── model/
│   │   ├── User.java            # (int id, String username)
│   │   ├── GameState.java       # immutable snapshot
│   │   └── GameModel.java       # slide/merge/undo/win/lose logic (NxN)
│   ├── view/
│   │   ├── EntryPanel.java      # User / Guest pick
│   │   ├── AuthPanel.java       # Login / Register
│   │   ├── SettingsPanel.java   # Grid size + timer mode picker
│   │   ├── GamePanel.java       # Main game screen (NxN + timer)
│   │   ├── GameFrame.java       # CardLayout host window
│   │   └── TileView.java        # Rounded-colour tile renderer
│   └── util/
│       ├── ColorMap.java        # Tile colours
│       ├── SoundManager.java    # Beep engine
│       ├── SaveManager.java     # File-based fallback persistence
│       └── DatabaseManager.java # PostgreSQL: users, scores (per-grid), saves (per-grid)
├── sql/init.sql                 # Schema bootstrap script (v2: grid_size column)
├── index.html                   # Static HTML5 version (GitHub Pages)
└── data/                        # Runtime saves (created on first launch)
```

---

## Running locally (Swing)

```bash
cd 2048-game-repo
javac -encoding UTF-8 -d out -sourcepath src src/Main.java
java -cp out Main
```

To supply connection details different from the defaults
(`localhost:5432/game2048`, user `postgres`, pass `postgres`):

```bash
java -Ddb.host=10.0.0.5 -Ddb.port=5432 -Ddb.name=cs109 \
     -Ddb.user=app -Ddb.pass=secret -cp out Main
```

If no PostgreSQL is reachable the program transparently falls back to
file-based storage – the full game still works in both modes.

---

## Setting up PostgreSQL (recommended)

```bash
# 1. connect as admin and create the DB
psql -U postgres -c "CREATE DATABASE game2048;"

# 2. apply the schema
psql -U postgres -d game2048 -f sql/init.sql
```

> **Upgrading from v1 schema?** The `scores` and `saves` tables now have a
> `grid_size` column. Drop and re-create them:
> ```sql
> DROP TABLE IF EXISTS scores, saves CASCADE;
> -- then re-run init.sql
> ```

---

## HTML5 version

`index.html` is a zero-dependency single-file build that runs entirely
in the browser.  Deploy it to **GitHub Pages** (enable Pages → source
`main` branch → `/`) or open it locally – no server needed.

All data (users, saves, per-grid leaderboards) lives in `localStorage`,
scoped to the origin.

---

## Flow

```
┌─────────────┐      ┌──────────────┐      ┌──────────────┐      ┌────────────┐
│ Entry       │──┬──▶│ Auth (User)  │──┬──▶│ Settings     │─────▶│ Game       │
│ User / Guest│  │   │ login/regs   │  │   │ grid + timer │      │ NxN + sim  │
└─────────────┘  │   └──────────────┘  │   └──────────────┘      └────────────┘
                 │                      │
                 └──────────────────────┘  (Guest skips Auth)
```

---

## Requirements reference

| Section | PDF spec | Implementation |
|---------|----------|----------------|
| Task 1 – Init | 4×4+, one 2 + one 4, restart, colours | `GameModel.init()` + `ColorMap` |
| Task 2 – Login | Guest / registered; persistence | `EntryPanel`, `AuthPanel`, `DatabaseManager` |
| Task 3 – Save/Load | 1 slot per user per grid; overwrite, graceful | `DatabaseManager.saveGame/loadGame` |
| Task 4 – Game | Slide/merge, buttons + keyboard, win/over | `GameModel.move`, `GamePanel.bindKeys` |
| Task 5 – GUI | Swing or JavaFX | Swing with custom `paintComponent`, glass cards |
| Task 6 – Advance | Animation, sound, timer, leaderboard | `SoundManager`, count-up/down timer, per-grid leaderboard |
