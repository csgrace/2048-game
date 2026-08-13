package view;

import javax.swing.*;
import java.awt.*;
import java.awt.event.KeyEvent;

/**
 * Base panel that listens to keyboard events and dispatches movement calls.
 */
public abstract class ListenerPanel extends JPanel {

    public ListenerPanel() {
        enableEvents(AWTEvent.KEY_EVENT_MASK);
        this.setFocusable(true);
    }

    @Override
    protected void processKeyEvent(KeyEvent e) {
        super.processKeyEvent(e);
        if (e.getID() == KeyEvent.KEY_PRESSED) {
            switch (e.getKeyCode()) {
                case KeyEvent.VK_UP, KeyEvent.VK_W    -> doMoveUp();
                case KeyEvent.VK_DOWN, KeyEvent.VK_S  -> doMoveDown();
                case KeyEvent.VK_LEFT, KeyEvent.VK_A  -> doMoveLeft();
                case KeyEvent.VK_RIGHT, KeyEvent.VK_D -> doMoveRight();
            }
        }
    }

    public abstract void doMoveUp();
    public abstract void doMoveDown();
    public abstract void doMoveLeft();
    public abstract void doMoveRight();
}
