package view;

import model.GridNumber;

import javax.swing.*;
import java.awt.*;
import java.util.ArrayDeque;
import java.util.Deque;

/**
 * Main game panel: holds the 4×4 grid of tile components and responds to
 * keyboard / button commands by forwarding movement orders to the model.
 */
public class GamePanel extends ListenerPanel {

    private final int COUNT = 4;
    private GridComponent[][] grids;
    private GridNumber model;

    private JLabel stepLabel;
    private JLabel scoreLabel;
    private int steps;

    private final int GRID_SIZE;

    /** Undo history – keeps up to 30 previous board states + score. */
    private final Deque<UndoEntry> undoStack = new ArrayDeque<>(30);

    private static class UndoEntry {
        int[][] grid;
        int score;
        UndoEntry(int[][] g, int s) { grid = g; score = s; }
    }

    public GamePanel(int size) {
        this.setVisible(true);
        this.setFocusable(true);
        this.setLayout(null);
        this.setBackground(new Color(187, 173, 160));
        this.setSize(size, size);
        this.GRID_SIZE = size / COUNT;
        this.model = new GridNumber(COUNT);
        buildGridComponents();
        initialGame();
    }

    private void buildGridComponents() {
        grids = new GridComponent[COUNT][COUNT];
        for (int i = 0; i < COUNT; i++) {
            for (int j = 0; j < COUNT; j++) {
                grids[i][j] = new GridComponent(i, j, GRID_SIZE);
                grids[i][j].setLocation(j * GRID_SIZE, i * GRID_SIZE);
                this.add(grids[i][j]);
            }
        }
    }

    public void initialGame() {
        steps = 0;
        undoStack.clear();
        model.initialNumbers();
        updateGridsNumber();
    }

    public GridNumber getModel() {
        return model;
    }

    /** Refresh every cell's displayed value from the model. */
    public void updateGridsNumber() {
        for (int i = 0; i < COUNT; i++) {
            for (int j = 0; j < COUNT; j++) {
                grids[i][j].setNumber(model.getNumber(i, j));
            }
        }
        repaint();
    }

    public void resetSteps() {
        steps = 0;
        if (stepLabel != null) stepLabel.setText("Step: 0");
        if (scoreLabel != null) scoreLabel.setText("Score: 0");
    }

    // -------------------------------------------------------------------------
    // Movement – called from both keyboard (ListenerPanel) and buttons
    // -------------------------------------------------------------------------

    @Override public void doMoveUp()    { performMove("up");    }
    @Override public void doMoveDown()  { performMove("down");  }
    @Override public void doMoveLeft()  { performMove("left");  }
    @Override public void doMoveRight() { performMove("right"); }

    private void performMove(String direction) {
        // snapshot for undo (board state + score BEFORE the move)
        undoStack.push(new UndoEntry(model.copyGridFull(), model.getScore()));
        if (undoStack.size() > 30) undoStack.removeLast();

        boolean moved = model.move(direction);
        if (!moved) {
            // no movement → discard the snapshot
            undoStack.pop();
            return;
        }

        steps++;
        if (stepLabel != null) stepLabel.setText("Step: " + steps);
        if (scoreLabel != null) scoreLabel.setText("Score: " + model.getScore());

        model.addRandomTile();
        updateGridsNumber();

        if (model.hasWon()) {
            JOptionPane.showMessageDialog(this, "You Win!  Score: " + model.getScore());
        } else if (model.isGameOver()) {
            JOptionPane.showMessageDialog(this, "Game Over.  Score: " + model.getScore());
        }
    }

    /** Returns true if undo was performed. */
    public boolean undo() {
        if (undoStack.isEmpty()) return false;
        UndoEntry prev = undoStack.pop();
        for (int r = 0; r < COUNT; r++) {
            for (int c = 0; c < COUNT; c++) {
                model.setNumber(r, c, prev.grid[r][c]);
            }
        }
        // Restore score (need to add a setter for score reflection)
        model.setScore(prev.score);
        steps--;
        if (stepLabel != null) stepLabel.setText("Step: " + steps);
        if (scoreLabel != null) scoreLabel.setText("Score: " + prev.score);
        return true;
    }

    // -------------------------------------------------------------------------
    // Label setters
    // -------------------------------------------------------------------------

    public void setStepLabel(JLabel stepLabel)   { this.stepLabel  = stepLabel; }
    public void setScoreLabel(JLabel scoreLabel){ this.scoreLabel = scoreLabel; }
}
