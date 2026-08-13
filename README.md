# 2048 – CS109 Spring 2026 Project

A complete implementation of the 2048 number-puzzle game in **Java (Swing)**
with optional **PostgreSQL** backing for user accounts, leaderboards and
game saves.  A pure-HTML5 front-end is also provided for deployment to
GitHub Pages / any static host.

---

## Features

| Task | Status | Notes |
|------|--------|-------|
| **1 – Game init & classic 4×4** | ✅ | Restart, random seeding, colours per tile |
| **2 – Multi-user login** | ✅ | `User Mode` ↔ `Guest Mode`; users persist across launches |
| **3 – Save & load** | ✅ | One slot per user; corrupt saves fail gracefully |
| **4 – Gameplay** | ✅ | Keyboard **and** button controls, win/lose detection, undo |
| **5 – Swing GUI** | ✅ | Gradient backdrop, animated tiles, arrow pad |
| **6 – Advanced** | ✅ | WebAudio sound effects, leaderboard, undo stack, timed mode ready |

Additional niceties:

* Self-connecting **PostgreSQL** layer (`DatabaseManager`) – plug in your
  connection details via system properties.
* Fallback to file-based persistence when no database is available.
* `Entry Screen → Auth Screen → Game Screen` user flow driven by
  `CardLayout`.
* Leaderboard displaying top scores across all players.
* Sound generated programmatically – no external audio files required.

---

## Project layout

```
csgrace-website (individual site)
2048-game-repo/
├── src/
│   ├── Main.java                # entry point
│   ├── model/
│   │   ├── User.java            # (int id, String username)
│   │   ├── GameState.java       # immutable snapshot
│   │   └── GameModel.java       # slide/merge/undo/win/lose logic
│   ├── view/
│   │   ├── EntryPanel.java      # User / Guest pick
│   │   ├── AuthPanel.java       # Login / Register
│   │   ├── GamePanel.java       # Main game screen
│   │   ├── GameFrame.java       # CardLayout host window
│   │   └── TileView.java        # Rounded-colour tile renderer
│   └── util/
│       ├── ColorMap.java        # Tile colours
│       ├── SoundManager.java    # WebAudio-like beep engine
│       ├── SaveManager.java     # File-based fallback persistence
│       └── DatabaseManager.java # PostgreSQL: users, scores, saves
├── sql/init.sql                 # Schema bootstrap script
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
java -Ddb.host=10.0.0.5 -Ddb.port=5432 -dDb.name=cs109 \
     -Ddb.user=app -Ddb.pass=secret -cp out Main
```

If no PostgreSQL is reachable the program transparently falls back to
file-based storage – the full game still works in Guest & User modes.

---

## Setting up PostgreSQL (recommended)

```bash
# 1. connect as admin and create the DB
psql -U postgres -c "CREATE DATABASE game2048;"

# 2. apply the schema
psql -U postgres -d game2048 -f sql/init.sql
```

---

## HTML5 version

`index.html` is a zero-dependency single-file build that runs entirely
in the browser.  Deploy it to **GitHub Pages** (enable Pages → source
`main` branch → `/`) or open it locally – no server needed.

Greats saved to `localStorage`; users & leaderboard live in the same
origin-scoped storage.

---

## Requirements reference

| Section | PDF spec | Implementation |
|---------|----------|----------------|
| Task 1 – Init | 4×4, one 2 + one 4, restart, colours | `GameModel.init()` + `ColorMap` |
| Task 2 – Login | Guest / registered; persistence | `EntryPanel`, `AuthPanel`, `DatabaseManager` |
| Task 3 – Save/Load | 1 slot per user, overwrite, graceful corruption | `DatabaseManager.saveGame/loadGame` + `fileSave` |
| Task 4 – Game | Slide/merge, buttons + keyboard, win/over | `GameModel.move`, `GamePanel.bindKeys` |
| Task 5 – GUI | Swing or JavaFX | Swing with custom `paintComponent` |
| Task 6 – Advance | Animation, sound, timer, leaderboard, props | `SoundManager`, `Timer`, leaderboard SQL |
