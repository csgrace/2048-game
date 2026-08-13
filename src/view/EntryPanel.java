package view;

import javax.swing.*;
import java.awt.*;
import java.awt.event.MouseAdapter;
import java.awt.event.MouseEvent;

/**
 * First screen: pick User Mode or Guest Mode (Task 2 entry).
 *
 * Two large buttons are styled like modern card picks.
 */
public class EntryPanel extends JPanel {

    public Runnable onUserMode;
    public Runnable onGuestMode;

    public EntryPanel() {
        setOpaque(false);
        setLayout(new GridBagLayout());
        setBorder(BorderFactory.createEmptyBorder(40, 60, 40, 60));

        GridBagConstraints g = new GridBagConstraints();
        g.insets = new Insets(12, 12, 12, 12);
        g.fill = GridBagConstraints.BOTH;
        g.weightx = 1;
        g.weighty = 1;

        // Title
        JLabel title = new JLabel("2048", SwingConstants.CENTER);
        title.setFont(new Font("SansSerif", Font.BOLD, 64));
        title.setForeground(new Color(249, 246, 242));
        g.gridx = 0; g.gridy = 0; g.gridwidth = 2;
        add(title, g);

        JLabel sub = new JLabel("Choose your mode", SwingConstants.CENTER);
        sub.setFont(new Font("SansSerif", Font.PLAIN, 18));
        sub.setForeground(new Color(220, 210, 200));
        g.gridy = 1;
        add(sub, g);

        // Buttons
        g.gridwidth = 1;
        g.gridy = 2;

        JButton userBtn  = bigButton("👤\nUser Mode",  "Login to save scores, compete on the leaderboard, and continue later.");
        JButton guestBtn = bigButton("🎮\nGuest Mode", "Jump straight in – no sign-up required. No persistency.");

        userBtn.addActionListener(e  -> { if (onUserMode  != null) onUserMode.run();  });
        guestBtn.addActionListener(e -> { if (onGuestMode != null) onGuestMode.run(); });

        g.gridx = 0; add(userBtn,  g);
        g.gridx = 1; add(guestBtn, g);
    }

    private JButton bigButton(String text, String tooltip) {
        JButton b = new JButton("<html><center>" + text.replace("\n", "<br>") + "</center></html>") {
            boolean hovered = false;
            {
                addMouseListener(new MouseAdapter() {
                    public void mouseEntered(MouseEvent e) { hovered = true;  repaint(); }
                    public void mouseExited (MouseEvent e) { hovered = false; repaint(); }
                });
            }
            @Override
            protected void paintComponent(Graphics g0) {
                Graphics2D g = (Graphics2D) g0.create();
                g.setRenderingHint(RenderingHints.KEY_ANTIALIASING,
                                    RenderingHints.VALUE_ANTIALIAS_ON);
                Color base  = new Color(143, 122, 102);
                Color light = new Color(165, 145, 120);
                g.setColor(hovered ? light : base);
                g.fillRoundRect(0, 0, getWidth(), getHeight(), 20, 20);
                g.dispose();
                super.paintComponent(g0);
            }
        };
        b.setFont(new Font("SansSerif", Font.BOLD, 22));
        b.setForeground(Color.WHITE);
        b.setPreferredSize(new Dimension(220, 160));
        b.setFocusable(false);
        b.setBorderPainted(false);
        b.setContentAreaFilled(false);
        b.setCursor(Cursor.getPredefinedCursor(Cursor.HAND_CURSOR));
        b.setToolTipText(tooltip);
        return b;
    }

    /** Painted as an overlay – let the parent's gradient show through. */
    @Override
    protected void paintComponent(Graphics g) {
        // intentionally transparent so the parent JWindow/JFrame gradient shows
        super.paintComponent(g);
    }
}
