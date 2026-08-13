package model;

import java.io.Serializable;

/**
 * Snapshot of a game at a single point in time.
 * Used both for in-memory undo history and disk persistency.
 */
public class GameState implements Serializable {

    private static final long serialVersionUID = 1L;

    private final int[][] board;
    private final int score;
    private final int steps;
    private final long elapsedMillis;

    public GameState(int[][] board, int score, int steps, long elapsedMillis) {
        this.board = new int[board.length][];
        for (int r = 0; r < board.length; r++) this.board[r] = board[r].clone();
        this.score = score;
        this.steps = steps;
        this.elapsedMillis = elapsedMillis;
    }

    public int[][] getBoard()         { return board; }
    public int     getScore()         { return score; }
    public int     getSteps()         { return steps; }
    public long    getElapsedMillis() { return elapsedMillis; }
}
