package view;

import javax.swing.*;
import java.awt.*;

/**
 * Intermediate screen where the player picks grid size and timer mode.
 *
 *   • Grid size   : 4×4 / 6×6 / 8×8
 *   • Timer mode   : count-up (stopwatch) or count-down (multiple durations)
 *
 * Depending on whether a user is logged in the "Start Game" button goes to
 * a {@link GamePanel} with size / timer baked in.
 */
public class SettingsPanel extends JPanel {

    public Runnable onStart;   // called with "4/up" / "6/down-120" etc.
    public Runnable onBack;

    private JComboBox<String> gridCombo;
    private JComboBox<String> timerCombo;

    public SettingsPanel() {
        setOpaque(false);
        setLayout(new GridBagLayout());
        setBorder(BorderFactory.createEmptyBorder(24, 32, 24, 32));

        GridBagConstraints g = new GridBagConstraints();
        g.insets = new Insets(8, 6, 8, 6);
        g.fill = GridBagConstraints.HORIZONTAL;
        g.gridwidth = 2;

        // title
        JLabel title = new JLabel("Game Settings", SwingConstants.CENTER);
        title.setFont(new Font("SansSerif", Font.BOLD, 28));
        title.setForeground(new Color(249, 246, 242));
        g.gridx = 0; g.gridy = 0;
        add(title, g);

        JLabel sub = new JLabel("Choose your board", SwingConstants.CENTER);
        sub.setFont(new Font("SansSerif", Font.PLAIN, 14));
        sub.setForeground(new Color(220, 210, 200));
        g.gridy = 1; g.insets = new Insets(2, 6, 18, 6);
        add(sub, g);

        // grid size
        g.gridwidth = 1;
        g.insets = new Insets(6, 6, 6, 6);

        JLabel gLabel = new JLabel("Grid Size:");
        gLabel.setForeground(Color.WHITE);
        gLabel.setFont(new Font("SansSerif", Font.BOLD, 14));
        g.gridx = 0; g.gridy = 2;
        add(gLabel, g);

        gridCombo = new JComboBox<>(new String[]{"4 × 4  (Classic)", "6 × 6  (Extended)", "8 × 8  (Mega)"});
        gridCombo.setFont(new Font("SansSerif", Font.PLAIN, 14));
        g.gridx = 1;
        add(gridCombo, g);

        // timer mode
        JLabel tLabel = new JLabel("Timer Mode:");
        tLabel.setForeground(Color.WHITE);
        tLabel.setFont(new Font("SansSerif", Font.BOLD, 14));
        g.gridx = 0; g.gridy = 3;
        add(tLabel, g);

        timerCombo = new JComboBox<>(new String[]{
            "⏱  Count Up (stopwatch)",
            "⏳  Count Down 60 sec",
            "⏳  Count Down 2 min",
            "⏳  Count Down 5 min"
        });
        timerCombo.setFont(new Font("SansSerif", Font.PLAIN, 14));
        g.gridx = 1;
        add(timerCombo, g);

        // buttons
        JPanel btnRow = new JPanel(new FlowLayout(FlowLayout.CENTER, 8, 0));
        btnRow.setOpaque(false);

        JButton backBtn = new JButton("← Back");
        JButton startBtn = new JButton("Start Game →");
        styleButton(backBtn, new Color(110, 100, 90));
        styleButton(startBtn, new Color(143, 122, 102));
        startBtn.setFont(new Font("SansSerif", Font.BOLD, 15));
        startBtn.setPreferredSize(new Dimension(160, 40));

        btnRow.add(backBtn);
        btnRow.add(startBtn);

        g.gridx = 0; g.gridy = 4; g.gridwidth = 2;
        g.insets = new Insets(22, 6, 4, 6);
        add(btnRow, g);

        // wire
        backBtn.addActionListener(e -> { if (onBack != null) onBack.run(); });
        startBtn.addActionListener(e -> {
            int size = new int[]{4, 6, 8}[gridCombo.getSelectedIndex()];
            String[] tm = {"up", "down-60", "down-120", "down-300"};
            String mode = tm[timerCombo.getSelectedIndex()];
            selectedSize = size;
            selectedTimer = mode;
            if (onStart != null) onStart.run();
        });
    }

    // remember selections so GameFrame can forward them
    int selectedSize = 4;
    String selectedTimer = "up";

    private void styleButton(JButton b, Color bg) {
        b.setBackground(bg);
        b.setForeground(Color.WHITE);
        b.setFont(new Font("SansSerif", Font.BOLD, 14));
        b.setFocusable(false);
        b.setPreferredSize(new Dimension(120, 36));
        b.setCursor(Cursor.getPredefinedCursor(Cursor.HAND_CURSOR));
    }
}
