package view;

import model.GameModel;
import model.GameState;
import model.User;
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
 *   • Centre    : NxN animated board (size picked in SettingsPanel)
 *   • Right bar : undo / save / load / restart / leaderboard buttons + arrow pad
 *   • Keyboard  : arrows + WASD (all modes)
 *
 * Guest Mode: Save + Load are disabled entirely – the user only sees Undo / Restart.
 * User Mode : every grid size has its own save slot and leaderboard page.
 */
public class GamePanel extends JPanel {

    private static final int TILE    = 104;
    private static final int GAP     = 12;
    private static final int PAD     = 14;

    private User              user;             // null = guest
    private GameModel         model;
    private DatabaseManager   db;               // null = no DB connected
    private SaveManager       fileSave;
    private boolean           keyboardEnabled;
    private int               gridSize;
    private String            timerMode;        // "up" | "down-60" | "down-120" | "down-300"
    private int               countdownTotal;   // seconds, only when timerMode starts with "down"
    private long              deadlineEpoch;    // System millis at which countdown hits 0

    private TileView[][] tiles;
    private JLabel       scoreLabel;
    private JLabel       stepLabel;
    private JLabel       timeLabel;
    private JLabel       modeLabel;
    private JButton       saveBtn;
    private JButton       loadBtn;
    private Timer         clock;
    private Timer         countdownTimer;

    /** Pre-load save from DB. */
    public static DatabaseManager.SaveData dbPreload;

    /* ------------------------------------------------------------------ ctor */

    public GamePanel(User user, DatabaseManager db, SaveManager fileSave,
                     int gridSize, String timerMode) {
        this.db         = db;
        this.fileSave   = fileSave;
        this.user       = user;
        this.keyboardEnabled = true;
        this.gridSize   = gridSize;
        this.timerMode  = timerMode;

        // countdown setup
        if (timerMode.startsWith("down-")) {
            this.countdownTotal = Integer.parseInt(timerMode.substring(5));
            this.deadlineEpoch  = System.currentTimeMillis() + countdownTotal * 1000L;
        }

        this.model = new GameModel(gridSize);

        // load anything that was pre-fetched for us
        if (user != null && db != null && dbPreload != null) {
            model.loadBoard(dbPreload.board(), dbPreload.score(), dbPreload.steps(), dbPreload.elapsedMs());
            dbPreload = null;
        } else {
            model.init();
        }

        buildUI();
        setOpaque(false);

        // keyboard controls
        bindKeys();

        // clock label tick (every 100 ms for smooth countdown)
        clock = new Timer(100, e -> updateTimerLabel());
        clock.start();
        updateTimerLabel();
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
        JPanel bar = new JPanel(new FlowLayout(FlowLayout.CENTER, 18, 8));
        bar.setOpaque(false);

        String who = (user == null) ? "Guest Mode" : user.username();
        JLabel nameLabel = new JLabel("👤 " + who);
        nameLabel.setFont(new Font("SansSerif", Font.BOLD, 15));
        nameLabel.setForeground(Color.WHITE);

        modeLabel  = statLabel(gridSize + "×" + gridSize, 0);
        scoreLabel = statLabel("🏆 Score", 0);
        stepLabel  = statLabel("👣 Steps", 0);
        timeLabel  = statLabel("⏱ Time", 0);

        bar.add(nameLabel);
        bar.add(modeLabel);
        bar.add(scoreLabel);
        bar.add(stepLabel);
        bar.add(timeLabel);
        return bar;
    }

    private JLabel statLabel(String title, int val) {
        JLabel l = new JLabel(title + ": " + val, SwingConstants.CENTER);
        l.setFont(new Font("SansSerif", Font.BOLD, 14));
        l.setForeground(new Color(220, 210, 200));
        l.setBorder(BorderFactory.createCompoundBorder(
            BorderFactory.createLineBorder(new Color(255, 255, 255, 50), 1, true),
            BorderFactory.createEmptyBorder(5, 10, 5, 10)
        ));
        return l;
    }

    private JPanel buildBoard() {
        int boardPx = TILE * gridSize + GAP * (gridSize - 1);
        JPanel board = new JPanel(new GridLayout(gridSize, gridSize, GAP, GAP)) {
            @Override public Dimension getPreferredSize() {
                return new Dimension(boardPx + PAD * 2, boardPx + PAD * 2);
            }
        };
        board.setBackground(new Color(187, 173, 160));
        board.setBorder(BorderFactory.createEmptyBorder(PAD, PAD, PAD, PAD));

        tiles = new TileView[gridSize][gridSize];
        for (int r = 0; r < gridSize; r++) {
            for (int c = 0; c < gridSize; c++) {
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
        loadBtn    = newBtn("📂 Load",   e -> doLoad());
        JButton undoBtn    = newBtn("↩ Undo",    e -> doUndo());
        JButton restartBtn = newBtn("↺ Restart", e -> doRestart());
        JButton boardBtn   = newBtn("🏆 Boards", e -> showLeaderboard());

        // Guest Mode: completely disable save and load
        if (user == null) {
            saveBtn.setEnabled(false);
            saveBtn.setToolTipText("Not available in Guest Mode");
            loadBtn.setEnabled(false);
            loadBtn.setToolTipText("Not available in Guest Mode");
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
        if (model.isOver() || isTimedOut()) return;
        boolean changed = model.move(direction);
        if (!changed) return;
        SoundManager.move();
        refreshAll();

        int winTarget = gridSize * gridSize * 2;  // e.g. 4×4→32, 6×6→72, 8×8→128 → we use 2048 always
        if (model.isWon()) {
            SoundManager.win();
            maybeSaveScore();
            JOptionPane.showMessageDialog(this,
                "🎉 You Win!\nScore: " + model.getScore() + "\nSteps: " + model.getSteps(),
                "Victory", JOptionPane.INFORMATION_MESSAGE);
        } else if (model.isOver()) {
            SoundManager.lose();
            maybeSaveScore();
            stopClock();
            int ok = JOptionPane.showConfirmDialog(this,
                "Game Over – score " + model.getScore() + "\nPlay again?",
                "Game Over", JOptionPane.YES_NO_OPTION);
            if (ok == JOptionPane.YES_OPTION) { model.init(); refreshAll(); startClock(); }
        }
    }

    private boolean isTimedOut() {
        if (!timerMode.startsWith("down-")) return false;
        return System.currentTimeMillis() >= deadlineEpoch;
    }

    private void stopClock()  { if (clock != null) clock.stop(); }
    private void startClock() { if (clock != null) clock.start(); updateTimerLabel(); }

    private void updateTimerLabel() {
        if (timerMode.equals("up")) {
            timeLabel.setText("⏱ " + model.getElapsedFormatted());
        } else {
            long remain = Math.max(0, deadlineEpoch - System.currentTimeMillis());
            long s = remain / 1000;
            timeLabel.setText("⏱ %02d:%02d".formatted(s / 60, s % 60));
            if (remain == 0 && !model.isOver()) {
                model = model; // no-op
                timeLabel.setText("⏱ 00:00");
            }
        }
    }

    /** If we have a user + db, push the score to the leaderboard (per-grid-size). */
    private void maybeSaveScore() {
        if (user != null && db != null) {
            db.recordScore(user.id(), model.getScore(), model.getSteps(),
                           model.getElapsedMillis(), gridSize);
        }
    }

    private void doUndo() {
        if (model.undo()) { SoundManager.move(); refreshAll(); }
        else { SoundManager.lose(); }
    }

    private void doSave() {
        if (user == null) {
            JOptionPane.showMessageDialog(this, "Saving is only available in User Mode.");
            return;
        }
        if (db == null) {
            JOptionPane.showMessageDialog(this, "No database connected.");
            return;
        }
        db.saveGame(user.id(), currentBoard(), model.getScore(), model.getSteps(),
                    model.getElapsedMillis());
        SoundManager.merge();
        JOptionPane.showMessageDialog(this, "✅ Game saved!");
    }

    private void doLoad() {
        if (user == null) {
            JOptionPane.showMessageDialog(this, "Loading is only available in User Mode.");
            return;
        }
        if (db == null) return;
        DatabaseManager.SaveData s = db.loadGame(user.id(), gridSize);
        if (s == null) { JOptionPane.showMessageDialog(this, "No save found for " + gridSize + "×" + gridSize + "."); return; }
        model.loadBoard(s.board(), s.score(), s.steps(), s.elapsedMs());
        SoundManager.merge();
        refreshAll();
        JOptionPane.showMessageDialog(this, "📂 Game loaded!");
    }

    private void doRestart() {
        model.init();
        SoundManager.move();
        refreshAll();
        // reset clock
        if (timerMode.startsWith("down-")) {
            deadlineEpoch = System.currentTimeMillis() + countdownTotal * 1000L;
        }
        startClock();
    }

    private int[][] currentBoard() {
        int[][] b = new int[gridSize][gridSize];
        for (int r = 0; r < gridSize; r++)
            for (int c = 0; c < gridSize; c++)
                b[r][c] = model.get(r, c);
        return b;
    }

    /* ------------------------------------------------------------------ leaderboard */

    private void showLeaderboard() {
        if (db == null) {
            JOptionPane.showMessageDialog(this, "Connect to PostgreSQL to view the leaderboard.");
            return;
        }
        List<DatabaseManager.ScoreRow> rows = db.leaderboard(gridSize, 20);
        if (rows.isEmpty()) {
            JOptionPane.showMessageDialog(this,
                "No scores yet for " + gridSize + "×" + gridSize + ". Be the first!");
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
        sp.setPreferredSize(new Dimension(460, 320));
        JOptionPane.showMessageDialog(this, sp,
            "🏆 High Scores – " + gridSize + "×" + gridSize, JOptionPane.PLAIN_MESSAGE);
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
        for (int r = 0; r < gridSize; r++)
            for (int c = 0; c < gridSize; c++)
                tiles[r][c].setValue(model.get(r, c));
        scoreLabel.setText("🏆 " + model.getScore());
        stepLabel.setText("👣 " + model.getSteps());
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
        stopClock();
    }
}
