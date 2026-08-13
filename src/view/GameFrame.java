package view;

import model.User;
import util.DatabaseManager;
import util.SaveManager;

import javax.swing.*;
import java.awt.*;

/**
 * Single window that transitions through three panels:
 *
 *   1. Entry   – choose User Mode or Guest Mode
 *   2. Auth    – login / register (only in User Mode)
 *   3. Game    – the actual 2048 board with keyboard, leaderboard, etc.
 *
 * Layout is {@link CardLayout} over a backdrop panel that paints a gradient,
 * giving the whole app a cohesive look without needing external images.
 */
public class GameFrame extends JFrame {

    private static final String P_ENTRY = "entry";
    private static final String P_AUTH  = "auth";
    private static final String P_GAME  = "game";

    private final CardLayout cl;
    private final JPanel     deck;

    private final DatabaseManager db;
    private final SaveManager     fileSave;
    private final AuthPanel       authPanel;
    private       User            loggedInUser;

    /** If PostgreSQL couldn't be contacted we flip this and use file-only mode. */
    private final boolean dbAvailable;

    public GameFrame(DatabaseManager db, SaveManager fileSave, boolean dbAvailable) {
        super("2048");
        this.db           = db;
        this.fileSave     = fileSave;
        this.dbAvailable  = dbAvailable;
        this.authPanel    = dbAvailable ? new AuthPanel(db) : null;

        setDefaultCloseOperation(EXIT_ON_CLOSE);
        setResizable(false);

        // backdrop with gradient
        cl   = new CardLayout();
        deck = new JPanel(cl) {
            @Override protected void paintComponent(Graphics g0) {
                super.paintComponent(g0);
                Graphics2D g = (Graphics2D) g0.create();
                g.setRenderingHint(RenderingHints.KEY_ANTIALIASING,
                                    RenderingHints.VALUE_ANTIALIAS_ON);
                GradientPaint gp = new GradientPaint(
                    0, 0, new Color(15, 20, 40),
                    getWidth(), getHeight(), new Color(50, 30, 80)
                );
                g.setPaint(gp);
                g.fillRect(0, 0, getWidth(), getHeight());
                // decorative dots
                g.setColor(new Color(255,255,255,14));
                for (int i = 0; i < 100; i++) {
                    int x = (i * 113 + 50) % getWidth();
                    int y = (i * 67  + 20) % getHeight();
                    g.fillOval(x, y, 2 + (i % 3), 2 + (i % 3));
                }
                g.dispose();
            }
        };
        deck.setLayout(cl);

        deck.add(buildEntry(), P_ENTRY);
        if (dbAvailable) {
            deck.add(authPanel,  P_AUTH);
        }

        setContentPane(deck);
        setSize(520, 400);
        setLocationRelativeTo(null);

        wireUp();
    }

    /* --------------------------------------------------------------- wiring */

    private void wireUp() {
        // Entry screen
        EntryPanel entry = (EntryPanel) deck.getComponent(0);
        entry.onUserMode  = () -> {
            if (dbAvailable) cl.show(deck, P_AUTH);
            else             startGame(null);
        };
        entry.onGuestMode = () -> startGame(null);

        // Auth screen
        if (dbAvailable) {
            authPanel.onAuthenticated = () -> startGame(authPanel.getAuthenticatedUser());
            authPanel.onBack          = () -> cl.show(deck, P_ENTRY);
        }
    }

    private void startGame(User user) {
        loggedInUser = user;
        GamePanel gp = new GamePanel(user, dbAvailable ? db : null, fileSave);
        deck.add(gp, P_GAME);
        cl.show(deck, P_GAME);
        pack();
        setSize(720, 680);
        setLocationRelativeTo(null);
        gp.requestFocusInWindow();
    }

    /* --------------------------------------------------------------- entry */

    private JPanel buildEntry() {
        return new EntryPanel();
    }
}
