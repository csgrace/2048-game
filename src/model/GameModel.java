package model;

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.List;
import java.util.Random;

/**
 * Core 2048 logic (Task 1 + Task 4).
 */
public class GameModel {

    public static final int DEFAULT_SIZE = 4;

    private final int size;
    private int[][] board;
    private int score;
    private int steps;
    private boolean won;
    private boolean over;
    private long startTime;

    private final Deque<GameState> undoStack = new ArrayDeque<>();
    private static final int MAX_UNDO = 30;
    private static final Random RND = new Random();

    public GameModel() { this(DEFAULT_SIZE); }

    public GameModel(int size) {
        this.size = size;
        this.board = new int[size][size];
        this.startTime = System.currentTimeMillis();
    }

    // ------------------------------------------------------------------ init

    public void init() {
        for (int r = 0; r < size; r++)
            for (int c = 0; c < size; c++) board[r][c] = 0;
        score = 0; steps = 0; won = false; over = false;
        undoStack.clear();
        startTime = System.currentTimeMillis();
        addRandomTile();
        addRandomTile();
    }

    /** Restore from a GameState snapshot (used by both load and undo). */
    public void loadState(GameState state) {
        int[][] saved = state.getBoard();
        this.board = new int[size][size];
        for (int r = 0; r < size && r < saved.length; r++)
            System.arraycopy(saved[r], 0, this.board[r], 0, Math.min(size, saved[r].length));
        this.score  = state.getScore();
        this.steps  = state.getSteps();
        this.won    = false;
        this.over   = false;
        this.startTime = System.currentTimeMillis() - state.getElapsedMillis();
        this.undoStack.clear();
    }

    /** Restore from a raw board (used by DatabaseManager.SaveData). */
    public void loadBoard(int[][] src, int score, int steps, long elapsedMs) {
        this.board = new int[size][size];
        for (int r = 0; r < size && r < src.length; r++)
            System.arraycopy(src[r], 0, this.board[r], 0, Math.min(size, src[r].length));
        this.score  = score;
        this.steps  = steps;
        this.won    = false;
        this.over   = false;
        this.startTime = System.currentTimeMillis() - elapsedMs;
        this.undoStack.clear();
    }

    public GameState toState() {
        return new GameState(board, score, steps, getElapsedMillis());
    }

    // ------------------------------------------------------------------ move

    /**
     * Slide and merge the board.
     * @return true if anything actually moved / merged.
     */
    public boolean move(String direction) {
        int[][] before = copyBoard();

        // push current state to undo stack BEFORE mutating
        undoStack.push(toState());
        if (undoStack.size() > MAX_UNDO) undoStack.removeLast();

        switch (direction.toLowerCase()) {
            case "up":    slideUp();    break;
            case "down":  slideDown();  break;
            case "left":  slideLeft();  break;
            case "right": slideRight(); break;
            default: undoStack.pop(); return false;
        }

        boolean changed = !equalsBoard(before, board);
        if (!changed) {
            // nothing moved – pop the snapshot we just pushed
            undoStack.pop();
            return false;
        }

        steps++;
        addRandomTile();
        if (!won && hasValue(2048)) won = true;
        over = isGameOver();
        return true;
    }

    public boolean undo() {
        if (undoStack.isEmpty()) return false;
        GameState prev = undoStack.pop();
        this.board = new int[size][size];
        for (int r = 0; r < size; r++) this.board[r] = prev.getBoard()[r].clone();
        this.score = prev.getScore();
        this.steps = prev.getSteps();
        this.over  = false;
        this.startTime = System.currentTimeMillis() - prev.getElapsedMillis();
        return true;
    }

    // ---- slide implementations ------------------------------------------

    private void slideLeft() {
        for (int r = 0; r < size; r++)
            System.arraycopy(slideAndMerge(board[r]), 0, board[r], 0, size);
    }
    private void slideRight() {
        for (int r = 0; r < size; r++) {
            int[] rev = reversed(board[r]);
            int[] m   = slideAndMerge(rev);
            System.arraycopy(reversed(m), 0, board[r], 0, size);
        }
    }
    private void slideUp() {
        for (int c = 0; c < size; c++) {
            int[] merged = slideAndMerge(column(c));
            for (int r = 0; r < size; r++) board[r][c] = merged[r];
        }
    }
    private void slideDown() {
        for (int c = 0; c < size; c++) {
            int[] rev    = reversed(column(c));
            int[] merged = slideAndMerge(rev);
            int[] out    = reversed(merged);
            for (int r = 0; r < size; r++) board[r][c] = out[r];
        }
    }

    private int[] slideAndMerge(int[] line) {
        int[] compact = new int[size];
        int pos = 0;
        for (int v : line) if (v != 0) compact[pos++] = v;
        int[] result = new int[size];
        int out = 0;
        for (int i = 0; i < pos; i++) {
            if (i + 1 < pos && compact[i] == compact[i + 1]) {
                result[out++] = compact[i] * 2;
                score += result[out - 1];
                i++;
            } else {
                result[out++] = compact[i];
            }
        }
        return result;
    }

    // ---- helpers ----------------------------------------------------------

    private int[] column(int c) {
        int[] col = new int[size];
        for (int r = 0; r < size; r++) col[r] = board[r][c];
        return col;
    }
    private int[] reversed(int[] a) {
        int[] r = new int[a.length];
        for (int i = 0; i < a.length; i++) r[i] = a[a.length - 1 - i];
        return r;
    }
    private int[][] copyBoard() {
        int[][] copy = new int[size][size];
        for (int r = 0; r < size; r++) copy[r] = board[r].clone();
        return copy;
    }
    private boolean equalsBoard(int[][] a, int[][] b) {
        for (int r = 0; r < size; r++)
            for (int c = 0; c < size; c++)
                if (a[r][c] != b[r][c]) return false;
        return true;
    }
    private boolean hasValue(int v) {
        for (int r = 0; r < size; r++)
            for (int c = 0; c < size; c++)
                if (board[r][c] == v) return true;
        return false;
    }

    private void addRandomTile() {
        List<int[]> empty = new ArrayList<>();
        for (int r = 0; r < size; r++)
            for (int c = 0; c < size; c++)
                if (board[r][c] == 0) empty.add(new int[]{r, c});
        if (empty.isEmpty()) return;
        int[] cell = empty.get(RND.nextInt(empty.size()));
        board[cell[0]][cell[1]] = RND.nextDouble() < 0.9 ? 2 : 4;
    }

    public boolean isGameOver() {
        for (int r = 0; r < size; r++)
            for (int c = 0; c < size; c++) {
                if (board[r][c] == 0) return false;
                if (c < size - 1 && board[r][c] == board[r][c + 1]) return false;
                if (r < size - 1 && board[r][c] == board[r + 1][c]) return false;
            }
        return true;
    }

    // ------------------------------------------------------------------ getters

    public int getSize() { return size; }
    public int getScore() { return score; }
    public int getSteps() { return steps; }
    public boolean isWon() { return won; }
    public boolean isOver() { return over; }
    public int get(int r, int c) { return board[r][c]; }
    public void setWon(boolean w) { this.won = w; }

    public long getElapsedMillis() { return System.currentTimeMillis() - startTime; }

    public String getElapsedFormatted() {
        long s = getElapsedMillis() / 1000;
        return "%02d:%02d".formatted(s / 60, s % 60);
    }
}
