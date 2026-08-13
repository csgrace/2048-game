package view;

import model.GameModel;
import model.GameState;
import model.User;
import util.ColorMap;
import util.DatabaseManager;
import util.SaveManager;
import util.SoundManager;

import javax.swing.*;
import java.awt.*;
import java.awt.event.*;
import java.util.List;

/**
 * The main game screen (Task 1 + Task 4 + Task 5 + Task 6).
 *
 *   • Top       : score / steps / time
 *   • Centre    : 4x4 animated board
 *   • Right bar : undo / save / load / restart / leaderboard buttons + arrow pad
 *   • Keyboard  : arrows + WASD (User Mode only)
 *
 * Friends of the class:
 *   • Record best score in PostgreSQL on game over (only User Mode)
 */
public class GamePanel extends JPanel {

    /* ------------------------------------------------------------------ constants */

    private static final int TILE = 104;
    private static final int GAP  = 12;
    private static final int PAD  = 14;
    private static final int BOARD_PX = TILE * 4 + GAP * 3;

    /* ------------------------------------------------------------------ fields */

    private User              user;             // null = guest
    private GameModel         model;
    private DatabaseManager   db;               // null = no DB connected
    private SaveManager       fileSave;         // always available as fallback
    private boolean           keyboardEnabled;

    private TileView[][] tiles;
    private JLabel       scoreLabel;
    private JLabel       stepLabel;
    private JLabel       timeLabel;
    private JButton       saveBtn;
    private Timer         clock;

    /** Pre-load save from DB (used when authenticating). */
    public static DatabaseManager.SaveData dbPreload;
    public static GameState               filePreload;

    /* ------------------------------------------------------------------ ctor */

    public GamePanel(User user, DatabaseManager db, SaveManager fileSave) {
        this.db       = db;
        this.fileSave = fileSave;

        if (user != null) {
            this.user = user;
            this.keyboardEnabled = true;
        } else {
            this.user = null;
            this.keyboardEnabled = true;   // keyboard works in guest too, just no save
        }

        this.model = new GameModel(4);

        // load anything that was pre-fetched for us
        if (user != null && db != null && dbPreload != null) {
            model.loadBoard(dbPreload.board(), dbPreload.score(), dbPreload.steps(), dbPreload.elapsedMs());
            dbPreload = null;
        } else if (filePreload != null) {
            model.loadState(filePreload);
            filePreload = null;
        } else {
            model.init();
        }

        buildUI();
        setPreferredSize(new Dimension(640, 600));
        setOpaque(false);

        // keyboard controls
        bindKeys();

        // animation timer for smooth-ish transitions (~30 fps)
        Timer animTimer = new Timer(16, e -> repaint());
        animTimer.start();

        // clock label
        clock = new Timer(500, e -> timeLabel.setText("⏱ " + model.getElapsedFormatted()));
        clock.start();
    }

    /* ------------------------------------------------------------------ UI build */

    private void buildUI() {
        setLayout(new BorderLayout(10, 0));
        setBorder(BorderFactory.createEmptyBorder(PAD, PAD, PAD, PAD));

        add(buildTopBar(),  BorderLayout.NORTH);
        add(buildBoard(),   BorderLayout.CENTER);
        add(buildSideBar(), BorderLayout.EAST);
    }

    private JPanel buildTopBar() {
        JPanel bar = new JPanel(new FlowLayout(FlowLayout.CENTER, 24, 8));
        bar.setOpaque(false);

        String who = (user == null) ? "Guest Mode" : user.username();
        JLabel nameLabel = new JLabel("👤 " + who);
        nameLabel.setFont(new Font("SansSerif", Font.BOLD, 15));
        nameLabel.setForeground(Color.WHITE);

        scoreLabel = statLabel("Score", 0);
        stepLabel  = statLabel("Steps", 0);
        timeLabel  = statLabel("Time",  0);

        bar.add(nameLabel);
        bar.add(scoreLabel);
        bar.add(stepLabel);
        bar.add(timeLabel);
        return bar;
    }

    private JLabel statLabel(String title, int val) {
        JLabel l = new JLabel(title + ": " + val, SwingConstants.CENTER);
        l.setFont(new Font("SansSerif", Font.BOLD, 15));
        l.setForeground(new Color(220, 210, 200));
        l.setBorder(BorderFactory.createCompoundBorder(
            BorderFactory.createLineBorder(new Color(255, 255, 255, 60), 1, true),
            BorderFactory.createEmptyBorder(6, 12, 6, 12)
        ));
        return l;
    }

    private JPanel buildBoard() {
        JPanel board = new JPanel(new GridLayout(4, 4, GAP, GAP)) {
            @Override public Dimension getPreferredSize() {
                return new Dimension(BOARD_PX + PAD * 2, BOARD_PX + PAD * 2);
            }
        };
        board.setBackground(new Color(187, 173, 160));
        board.setBorder(BorderFactory.createEmptyBorder(PAD, PAD, PAD, PAD));

        tiles = new TileView[4][4];
        for (int r = 0; r < 4; r++) {
            for (int c = 0; c < 4; c++) {
                tiles[r][c] = new TileView();
                tiles[r][c].setPreferredSize(new Dimension(TILE, TILE));
                board.add(tiles[r][c]);
            }
        }
        return board;
    }

    private JPanel buildSideBar() {
        JPanel bar = new JPanel();
        bar.setLayout(new BoxLayout(bar, BoxLayout.Y_AXIS));
        bar.setOpaque(false);
        bar.setBorder(BorderFactory.createEmptyBorder(PAD, 6, PAD, 0));

        saveBtn    = newBtn("💾 Save",   e -> doSave());
        JButton loadBtn    = newBtn("📂 Load",   e -> doLoad());
        JButton undoBtn    = newBtn("↩ Undo",    e -> doUndo());
        JButton restartBtn = newBtn("↺ Restart", e -> doRestart());
        JButton boardBtn   = newBtn("🏆 Boards", e -> showLeaderboard());

        if (user == null || db == null) {
            saveBtn.setEnabled(false);
            saveBtn.setToolTipText("Login to enable saving");
        }

        bar.add(saveBtn);      bar.add(Box.createVerticalStrut(6));
        bar.add(loadBtn);      bar.add(Box.createVerticalStrut(6));
        bar.add(undoBtn);      bar.add(Box.createVerticalStrut(6));
        bar.add(restartBtn);   bar.add(Box.createVerticalStrut(6));
        bar.add(boardBtn);     bar.add(Box.createVerticalStrut(16));

        // Arrow pad
        JPanel arrows = new JPanel(new GridBagLayout());
        arrows.setOpaque(false);
        GridBagConstraints g = new GridBagConstraints();
        g.insets = new Insets(3, 3, 3, 3);

        JButton up    = newBtn("↑");  up.addActionListener(e -> move("up"));
        JButton left  = newBtn("←");  left.addActionListener(e -> move("left"));
        JButton down  = newBtn("↓");  down.addActionListener(e -> move("down"));
        JButton right = newBtn("→");  right.addActionListener(e -> move("right"));

        Dimension aSize = new Dimension(46, 42);
        for (JButton b : new JButton[]{up, left, down, right}) {
            b.setPreferredSize(aSize);
            b.setFont(new Font("SansSerif", Font.BOLD, 20));
            b.setMaximumSize(aSize);
        }

        g.gridx = 1; g.gridy = 0; arrows.add(up,    g);
        g.gridx = 0; g.gridy = 1; arrows.add(left,  g);
        g.gridx = 1; g.gridy = 1; arrows.add(down,  g);
        g.gridx = 2; g.gridy = 1; arrows.add(right, g);

        bar.add(arrows);
        bar.add(Box.createVerticalGlue());
        return bar;
    }

    private JButton newBtn(String text) { return newBtn(text, null); }
    private JButton newBtn(String text, java.awt.event.ActionListener al) {
        JButton b = new JButton(text) {
            boolean hovered = false;
            { addMouseListener(new MouseAdapter() {
                  public void mouseEntered(MouseEvent e) { hovered = true;  repaint(); }
                  public void mouseExited (MouseEvent e) { hovered = false; repaint(); }
              }); }
            @Override protected void paintComponent(Graphics g0) {
                Graphics2D g = (Graphics2D) g0.create();
                g.setRenderingHint(RenderingHints.KEY_ANTIALIASING,
                                    RenderingHints.VALUE_ANTIALIAS_ON);
                Color base  = isEnabled() ? new Color(143, 122, 102) : new Color(90, 90, 90);
                Color light = new Color(165, 145, 120);
                g.setColor(hovered && isEnabled() ? light : base);
                g.fillRoundRect(0, 0, getWidth(), getHeight(), 10, 10);
                g.dispose();
                super.paintComponent(g0);
            }
        };
        b.setAlignmentX(Component.CENTER_ALIGNMENT);
        b.setFont(new Font("SansSerif", Font.BOLD, 13));
        b.setForeground(Color.WHITE);
        b.setFocusable(false);
        b.setMaximumSize(new Dimension(150, 38));
        b.setPreferredSize(new Dimension(150, 38));
        b.setBorderPainted(false);
        b.setContentAreaFilled(false);
        b.setCursor(Cursor.getPredefinedCursor(Cursor.HAND_CURSOR));
        if (al != null) b.addActionListener(al);
        return b;
    }

    /* ------------------------------------------------------------------ game actions */

    private void move(String direction) {
        boolean changed = model.move(direction);
        if (!changed) return;
        SoundManager.move();
        refreshAll();

        if (model.isWon()) {
            SoundManager.win();
            maybeSaveScore();
            JOptionPane.showMessageDialog(this,
                "🎉 You Win!\nScore: " + model.getScore() + "\nSteps: " + model.getSteps(),
                "Victory", JOptionPane.INFORMATION_MESSAGE);
        } else if (model.isOver()) {
            SoundManager.lose();
            maybeSaveScore();
            int ok = JOptionPane.showConfirmDialog(this,
                "Game Over – score " + model.getScore() + "\nPlay again?",
                "Game Over", JOptionPane.YES_NO_OPTION);
            if (ok == JOptionPane.YES_OPTION) { model.init(); refreshAll(); }
        }
    }

    /** If we have a user + db, push the score to the leaderboard. */
    private void maybeSaveScore() {
        if (user != null && db != null) {
            db.recordScore(user.id(), model.getScore(), model.getSteps(), model.getElapsedMillis());
        }
    }

    private void doUndo() {
        if (model.undo()) { SoundManager.move(); refreshAll(); }
        else { SoundManager.lose(); }
    }

    private void doSave() {
        if (user == null || db == null) {
            JOptionPane.showMessageDialog(this, "Saving is only available in User Mode (with DB).");
            return;
        }
        db.saveGame(user.id(), currentBoard(), model.getScore(), model.getSteps(), model.getElapsedMillis());
        SoundManager.merge();
        JOptionPane.showMessageDialog(this, "✅ Game saved!");
    }

    private void doLoad() {
        if (user == null || db == null) return;
        DatabaseManager.SaveData s = db.loadGame(user.id(), 4);
        if (s == null) { JOptionPane.showMessageDialog(this, "No save found."); return; }
        model.loadBoard(s.board(), s.score(), s.steps(), s.elapsedMs());
        SoundManager.merge();
        refreshAll();
        JOptionPane.showMessageDialog(this, "📂 Game loaded!");
    }

    private void doRestart() {
        model.init();
        SoundManager.move();
        refreshAll();
    }

    private int[][] currentBoard() {
        int[][] b = new int[4][4];
        for (int r = 0; r < 4; r++)
            for (int c = 0; c < 4; c++)
                b[r][c] = model.get(r, c);
        return b;
    }

    /* ------------------------------------------------------------------ leaderboard */

    private void showLeaderboard() {
        if (db == null) {
            JOptionPane.showMessageDialog(this, "Connect to PostgreSQL to view the leaderboard.");
            return;
        }
        List<DatabaseManager.ScoreRow> rows = db.leaderboard(20);
        if (rows.isEmpty()) {
            JOptionPane.showMessageDialog(this, "No scores yet. Be the first!");
            return;
        }
        String[] cols = {"#", "User", "Score", "Steps", "Time"};
        Object[][] data = new Object[rows.size()][5];
        int i = 0;
        for (DatabaseManager.ScoreRow r : rows) {
            data[i++] = new Object[]{
                i, r.username(), r.score(), r.steps(),
                "%02d:%02d".formatted(r.durationS() / 60, r.durationS() % 60)
            };
        }
        JTable tbl = new JTable(data, cols);
        tbl.setRowHeight(22);
        tbl.setEnabled(false);
        tbl.setBackground(new Color(250, 248, 239));
        JScrollPane sp = new JScrollPane(tbl);
        sp.setPreferredSize(new Dimension(440, 320));
        JOptionPane.showMessageDialog(this, sp, "🏆 High Scores", JOptionPane.PLAIN_MESSAGE);
    }

    /* ------------------------------------------------------------------ keyboard */

    private void bindKeys() {
        JRootPane rp = SwingUtilities.getRootPane(this);
        if (rp == null) return;
        InputMap  im = rp.getInputMap(JComponent.WHEN_IN_FOCUSED_WINDOW);
        ActionMap am = rp.getActionMap();

        String[] ks = {"UP","DOWN","LEFT","RIGHT","W","A","S","D"};
        for (String k : ks) im.put(KeyStroke.getKeyStroke(k), "mv_" + k);

        am.put("mv_UP",    mkAction("up"));
        am.put("mv_DOWN",  mkAction("down"));
        am.put("mv_LEFT",  mkAction("left"));
        am.put("mv_RIGHT", mkAction("right"));
        am.put("mv_W",     mkAction("up"));
        am.put("mv_S",     mkAction("down"));
        am.put("mv_A",     mkAction("left"));
        am.put("mv_D",     mkAction("right"));
    }

    private Action mkAction(String dir) {
        return new AbstractAction() {
            public void actionPerformed(ActionEvent e) {
                if (keyboardEnabled) move(dir);
            }
        };
    }

    /* ------------------------------------------------------------------ rendering */

    private void refreshAll() {
        for (int r = 0; r < 4; r++)
            for (int c = 0; c < 4; c++)
                tiles[r][c].setValue(model.get(r, c));
        scoreLabel.setText("🏆 Score: " + model.getScore());
        stepLabel.setText("👣 Steps: " + model.getSteps());
    }

    /** Gradient backdrop. */
    @Override
    protected void paintComponent(Graphics g0) {
        super.paintComponent(g0);
        Graphics2D g = (Graphics2D) g0.create();
        g.setRenderingHint(RenderingHints.KEY_ANTIALIASING,
                            RenderingHints.VALUE_ANTIALIAS_ON);
        GradientPaint gp = new GradientPaint(
            0, 0, new Color(20, 25, 45),
            getWidth(), getHeight(), new Color(60, 45, 90)
        );
        g.setPaint(gp);
        g.fillRect(0, 0, getWidth(), getHeight());
        // Subtle vignette / dots
        g.setColor(new Color(255, 255, 255, 18));
        for (int i = 0; i < 80; i++) {
            int x = (i * 97) % getWidth();
            int y = (i * 71) % getHeight();
            g.fillOval(x, y, 3, 3);
        }
        g.dispose();
    }

    @Override
    public void removeNotify() {
        super.removeNotify();
        if (clock != null) clock.stop();
    }
}
