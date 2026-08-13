package view;

import controller.GameController;
import util.ColorMap;

import javax.swing.*;
import java.awt.*;

/**
 * Top-level frame: panel (board) + control buttons (restart, save, load,
 * undo) + status labels (step, score).
 *
 * Layout is intentionally kept simple (absolute positions) so the code is
 * easy to follow – useful for a teaching / demo project.
 */
public class GameFrame extends JFrame {

    private final GameController controller;

    public GameFrame(int width, int height) {
        this.setTitle("2024 CS109 Project Demo – 2048");
        this.setLayout(null);
        this.setSize(width, height);
        ColorMap.InitialColorMap();

        // --- Board panel (occupies most of the window) ---
        int boardSize = (int) (height * 0.8);
        GamePanel gamePanel = new GamePanel(boardSize);
        gamePanel.setLocation(20, 20);
        this.add(gamePanel);

        // --- Controller needs a fully-built model + view ---
        this.controller = new GameController(gamePanel, gamePanel.getModel());

        // --- Labels ---
        JLabel stepLabel  = createLabel("Step: 0",
                new Font("SansSerif", Font.BOLD, 16),
                new Point(480, 30), 180, 30);
        JLabel scoreLabel = createLabel("Score: 0",
                new Font("SansSerif", Font.BOLD, 16),
                new Point(480, 60), 180, 30);
        gamePanel.setStepLabel(stepLabel);
        gamePanel.setScoreLabel(scoreLabel);

        // --- Buttons ---
        createButton("Restart", new Point(480, 110), 120, 40,
                e -> controller.restartGame());

        createButton("Undo", new Point(480, 160), 120, 40,
                e -> controller.undoGame());

        createButton("Save", new Point(480, 210), 120, 40,
                e -> controller.saveGame());

        createButton("Load", new Point(480, 260), 120, 40,
                e -> controller.loadGame());

        createButton("↑", new Point(520, 320), 50, 40,
                e -> { gamePanel.doMoveUp();    gamePanel.requestFocusInWindow(); });

        createButton("←", new Point(460, 370), 50, 40,
                e -> { gamePanel.doMoveLeft();  gamePanel.requestFocusInWindow(); });

        createButton("↓", new Point(520, 370), 50, 40,
                e -> { gamePanel.doMoveDown();  gamePanel.requestFocusInWindow(); });

        createButton("→", new Point(580, 370), 50, 40,
                e -> { gamePanel.doMoveRight(); gamePanel.requestFocusInWindow(); });

        // --- Final frame setup ---
        this.setLocationRelativeTo(null);
        this.setDefaultCloseOperation(WindowConstants.EXIT_ON_CLOSE);
        gamePanel.requestFocusInWindow();
    }

    // -------------------------------------------------------------------------
    // Helpers
    // -------------------------------------------------------------------------

    private JButton createButton(String name, Point loc, int w, int h,
                                 java.awt.event.ActionListener al) {
        JButton button = new JButton(name);
        button.setLocation(loc);
        button.setSize(w, h);
        button.setFocusable(false);
        button.setFont(new Font("SansSerif", Font.BOLD, 16));
        button.addActionListener(al);
        this.add(button);
        return button;
    }

    private JLabel createLabel(String text, Font font, Point loc, int w, int h) {
        JLabel label = new JLabel(text);
        label.setFont(font);
        label.setLocation(loc);
        label.setSize(w, h);
        this.add(label);
        return label;
    }
}
