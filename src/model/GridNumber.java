package model;

import java.util.Random;

/**
 * Core game logic for 2048.
 * Manages the grid state, tile movement, merging, and score tracking.
 */
public class GridNumber {

    private final int SIZE;
    private int[][] numbers;
    private int score;

    private static final Random RANDOM = new Random();

    // -------------------------------------------------------------------------
    // Construction / reset
    // -------------------------------------------------------------------------

    public GridNumber(int size) {
        this.SIZE = size;
        this.numbers = new int[SIZE][SIZE];
        this.score = 0;
    }

    /** Reset to empty board and add two starting tiles. */
    public void initialNumbers() {
        for (int r = 0; r < SIZE; r++) {
            for (int c = 0; c < SIZE; c++) {
                numbers[r][c] = 0;
            }
        }
        score = 0;
        addRandomTile();
        addRandomTile();
    }

    // -------------------------------------------------------------------------
    // Movement
    // -------------------------------------------------------------------------

    /**
     * Attempt to move in the given direction.
     * @return true if any tile actually moved
     */
    public boolean move(String direction) {
        int[][] before = copyGrid();
        switch (direction) {
            case "up":    moveUp();    break;
            case "down":  moveDown();  break;
            case "left":  moveLeft();  break;
            case "right": moveRight(); break;
            default: return false;
        }
        return !gridEquals(before, numbers);
    }

    // --- LEFT ---------------------------------------------------------------

    private void moveLeft() {
        for (int r = 0; r < SIZE; r++) {
            int[] row = extractRow(r);
            row = slideAndMerge(row);
            for (int c = 0; c < SIZE; c++) {
                numbers[r][c] = row[c];
            }
        }
    }

    // --- RIGHT --------------------------------------------------------------

    private void moveRight() {
        for (int r = 0; r < SIZE; r++) {
            int[] row = extractRow(r);
            reverse(row);
            row = slideAndMerge(row);
            reverse(row);
            for (int c = 0; c < SIZE; c++) {
                numbers[r][c] = row[c];
            }
        }
    }

    // --- UP -----------------------------------------------------------------

    private void moveUp() {
        for (int c = 0; c < SIZE; c++) {
            int[] col = new int[SIZE];
            for (int r = 0; r < SIZE; r++) col[r] = numbers[r][c];
            col = slideAndMerge(col);
            for (int r = 0; r < SIZE; r++) numbers[r][c] = col[r];
        }
    }

    // --- DOWN ---------------------------------------------------------------

    private void moveDown() {
        for (int c = 0; c < SIZE; c++) {
            int[] col = new int[SIZE];
            for (int r = 0; r < SIZE; r++) col[r] = numbers[r][c];
            reverse(col);
            col = slideAndMerge(col);
            reverse(col);
            for (int r = 0; r < SIZE; r++) numbers[r][c] = col[r];
        }
    }

    // -------------------------------------------------------------------------
    // Helpers
    // -------------------------------------------------------------------------

    /** Slide non-zero values to the left and merge equal neighbours. */
    private int[] slideAndMerge(int[] line) {
        // filter non-zero
        int[] filtered = new int[line.length];
        int idx = 0;
        for (int v : line) {
            if (v != 0) filtered[idx++] = v;
        }
        // merge
        int[] result = new int[line.length];
        int out = 0;
        for (int i = 0; i < idx; i++) {
            if (i + 1 < idx && filtered[i] == filtered[i + 1]) {
                result[out++] = filtered[i] * 2;
                score += result[out - 1];
                i++; // skip next – already merged
            } else {
                result[out++] = filtered[i];
            }
        }
        // rest stays 0
        return result;
    }

    private int[] extractRow(int r) {
        int[] row = new int[SIZE];
        System.arraycopy(numbers[r], 0, row, 0, SIZE);
        return row;
    }

    private void reverse(int[] a) {
        for (int i = 0, j = a.length - 1; i < j; i++, j--) {
            int tmp = a[i]; a[i] = a[j]; a[j] = tmp;
        }
    }

    private int[][] copyGrid() {
        int[][] copy = new int[SIZE][SIZE];
        for (int r = 0; r < SIZE; r++) {
            System.arraycopy(numbers[r], 0, copy[r], 0, SIZE);
        }
        return copy;
    }

    /** Deep copy used by undo – pure grid (no score). */
    public int[][] copyGridFull() {
        return copyGrid();
    }

    private boolean gridEquals(int[][] a, int[][] b) {
        for (int r = 0; r < SIZE; r++) {
            for (int c = 0; c < SIZE; c++) {
                if (a[r][c] != b[r][c]) return false;
            }
        }
        return true;
    }

    // -------------------------------------------------------------------------
    // Random tile
    // -------------------------------------------------------------------------

    public void addRandomTile() {
        java.util.List<int[]> emptyCells = new java.util.ArrayList<>();
        for (int r = 0; r < SIZE; r++) {
            for (int c = 0; c < SIZE; c++) {
                if (numbers[r][c] == 0) emptyCells.add(new int[]{r, c});
            }
        }
        if (emptyCells.isEmpty()) return;
        int[] cell = emptyCells.get(RANDOM.nextInt(emptyCells.size()));
        numbers[cell[0]][cell[1]] = RANDOM.nextDouble() < 0.9 ? 2 : 4;
    }

    // -------------------------------------------------------------------------
    // Win / lose
    // -------------------------------------------------------------------------

    /** True if no empty cells AND no adjacent equal cells. */
    public boolean isGameOver() {
        for (int r = 0; r < SIZE; r++) {
            for (int c = 0; c < SIZE; c++) {
                if (numbers[r][c] == 0) return false;
                if (c < SIZE - 1 && numbers[r][c] == numbers[r][c + 1]) return false;
                if (r < SIZE - 1 && numbers[r][c] == numbers[r + 1][c]) return false;
            }
        }
        return true;
    }

    public boolean hasWon() {
        for (int r = 0; r < SIZE; r++) {
            for (int c = 0; c < SIZE; c++) {
                if (numbers[r][c] == 2048) return true;
            }
        }
        return false;
    }

    // -------------------------------------------------------------------------
    // Getters / setters
    // -------------------------------------------------------------------------

    public int getNumber(int r, int c) {
        return numbers[r][c];
    }

    public int getScore() {
        return score;
    }

    public int getSize() {
        return SIZE;
    }

    public void setNumber(int r, int c, int v) {
        numbers[r][c] = v;
    }

    public void setScore(int s) {
        this.score = s;
    }

    public void printNumber() {
        for (int[] line : numbers) {
            System.out.println(java.util.Arrays.toString(line));
        }
    }
}
