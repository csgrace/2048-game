package controller;

import model.GridNumber;
import view.GamePanel;

/**
 * Handles button actions coming from GameFrame and routes them to the
 * model / view.
 */
public class GameController {

    private final GamePanel  view;
    private final GridNumber model;

    public GameController(GamePanel view, GridNumber model) {
        this.view  = view;
        this.model = model;
    }

    public void restartGame() {
        model.initialNumbers();
        view.resetSteps();
        view.updateGridsNumber();
        view.requestFocusInWindow();
    }

    public void loadGame() {
        String path = javax.swing.JOptionPane.showInputDialog(view, "Input path:");
        if (path != null && !path.isBlank()) {
            System.out.println("Loading from: " + path);
        }
        view.requestFocusInWindow();
    }

    public void saveGame() {
        System.out.println("Saving game...");
        view.requestFocusInWindow();
    }

    public void undoGame() {
        if (view.undo()) {
            view.updateGridsNumber();
        }
        view.requestFocusInWindow();
    }
}
