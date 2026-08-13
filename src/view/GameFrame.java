package view;

import model.User;
import util.DatabaseManager;
import util.SaveManager;

import javax.swing.*;
import java.awt.*;

/**
 * Single window that transitions through four panels:
 *
 *   1. Entry     → choose User Mode or Guest Mode
 *   2. Auth      → login / register (only in User Mode)
 *   3. Settings  → pick grid size + timer mode
 *   4. Game      → the actual N×N board
 *
 * Layout is {@link CardLayout} over a backdrop panel that paints an animated
 * gradient, giving the whole app a cohesive look without external images.
 */
public class GameFrame extends JFrame {

    private static final String P_ENTRY    = "entry";
    private static final String P_AUTH     = "auth";
    private static final String P_SETTINGS = "settings";
    private static final String P_GAME     = "game";

    private final CardLayout cl;
    private final JPanel     deck;

    private final DatabaseManager db;
    private final SaveManager     fileSave;
    private final AuthPanel       authPanel;
    private final SettingsPanel   settingsPanel;
    private       User            loggedInUser;

    /** If PostgreSQL couldn't be contacted we flip this and use file-only mode. */
    private final boolean dbAvailable;

    public GameFrame(DatabaseManager db, SaveManager fileSave, boolean dbAvailable) {
        super("2048");
        this.db            = db;
        this.fileSave      = fileSave;
        this.dbAvailable   = dbAvailable;
        this.authPanel     = dbAvailable ? new AuthPanel(db) : null;
        this.settingsPanel = new SettingsPanel();

        setDefaultCloseOperation(EXIT_ON_CLOSE);
        setResizable(false);

        // backdrop with gradient + stars
        cl   = new CardLayout();
        deck = new JPanel(cl) {
            @Override protected void paintComponent(Graphics g0) {
                super.paintComponent(g0);
                Graphics2D g = (Graphics2D) g0.create();
                g.setRenderingHint(RenderingHints.KEY_ANTIALIASING,
                                    RenderingHints.VALUE_ANTIALIAS_ON);
                // Deep purple/navy gradient
                GradientPaint gp = new GradientPaint(
                    0, 0, new Color(10, 15, 35),
                    getWidth(), getHeight(), new Color(45, 25, 75)
                );
                g.setPaint(gp);
                g.fillRect(0, 0, getWidth(), getHeight());
                // Soft radial glow
                g.setComposite(AlphaComposite.getInstance(AlphaComposite.SRC_OVER, 0.18f));
                g.setColor(new Color(143, 122, 102));
                g.fillOval(getWidth()/2 - 200, getHeight()/2 - 200, 400, 400);
                g.setComposite(AlphaComposite.SrcOver);
                // decorative dots
                g.setColor(new Color(255,255,255,12));
                for (int i = 0; i < 120; i++) {
                    int x = (i * 113 + 50) % getWidth();
                    int y = (i * 67  + 20) % getHeight();
                    g.fillOval(x, y, 2 + (i % 3), 2 + (i % 3));
                }
                g.dispose();
            }
        };
        deck.setLayout(cl);

        deck.add(new EntryPanel(),    P_ENTRY);
        if (dbAvailable) deck.add(authPanel,     P_AUTH);
        deck.add(settingsPanel,        P_SETTINGS);

        setContentPane(deck);
        setSize(560, 440);
        setLocationRelativeTo(null);

        wireUp();
    }

    /* --------------------------------------------------------------- wiring */

    private void wireUp() {

        // ----- Entry -----
        EntryPanel entry = (EntryPanel) deck.getComponent(0);
        entry.onUserMode  = () -> {
            if (dbAvailable) cl.show(deck, P_AUTH);
            else             cl.show(deck, P_SETTINGS);
        };
        entry.onGuestMode = () -> {
            loggedInUser = null;
            cl.show(deck, P_SETTINGS);
        };

        // ----- Auth -----
        if (dbAvailable) {
            authPanel.onAuthenticated = () -> {
                loggedInUser = authPanel.getAuthenticatedUser();
                cl.show(deck, P_SETTINGS);
            };
            authPanel.onBack = () -> cl.show(deck, P_ENTRY);
        }

        // ----- Settings -----
        settingsPanel.onBack = () -> {
            if (loggedInUser != null && dbAvailable) cl.show(deck, P_AUTH);
            else                                       cl.show(deck, P_ENTRY);
        };
        settingsPanel.onStart = () ->
            startGame(loggedInUser, settingsPanel.selectedSize, settingsPanel.selectedTimer);
    }

    private void startGame(User user, int gridSize, String timerMode) {
        GamePanel gp = new GamePanel(user, dbAvailable ? db : null, fileSave, gridSize, timerMode);
        deck.add(gp, P_GAME);
        cl.show(deck, P_GAME);
        pack();
        int dim = switch (gridSize) {
            case 6 -> 720;
            case 8 -> 900;
            default -> 720;
        };
        setSize(dim, dim + 100);
        setLocationRelativeTo(null);
        gp.requestFocusInWindow();
    }
}
