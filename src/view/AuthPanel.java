package view;

import model.User;
import util.DatabaseManager;
import util.SoundManager;

import javax.swing.*;
import java.awt.*;
import java.awt.event.ActionEvent;
import java.awt.event.ActionListener;

/**
 * Login / Register screen (Task 2 – inside User Mode).
 */
public class AuthPanel extends JPanel {

    public Runnable onAuthenticated;   // called with logged-in user
    public Runnable onBack;

    private final DatabaseManager db;
    private JTextField     usernameField;
    private JPasswordField passwordField;
    private JLabel         statusLabel;
    // tracks the most recent authenticated user id
    private int authUserId = -1;
    private String authUsername;

    public AuthPanel(DatabaseManager db) {
        this.db = db;
        setOpaque(false);
        setLayout(new GridBagLayout());
        setBorder(BorderFactory.createEmptyBorder(24, 40, 24, 40));

        GridBagConstraints g = new GridBagConstraints();
        g.insets = new Insets(6, 6, 6, 6);
        g.fill = GridBagConstraints.HORIZONTAL;

        // title
        JLabel title = new JLabel("User Mode", SwingConstants.CENTER);
        title.setFont(new Font("SansSerif", Font.BOLD, 32));
        title.setForeground(new Color(249, 246, 242));
        g.gridx = 0; g.gridy = 0; g.gridwidth = 2;
        add(title, g);

        // subtitle
        JLabel sub = new JLabel("Log in or register to continue", SwingConstants.CENTER);
        sub.setFont(new Font("SansSerif", Font.PLAIN, 14));
        sub.setForeground(new Color(220, 210, 200));
        g.gridy = 1;
        add(sub, g);

        // username
        JLabel uLabel = new JLabel("Username:");
        uLabel.setForeground(Color.WHITE);
        uLabel.setFont(new Font("SansSerif", Font.BOLD, 14));
        usernameField = new JTextField(16);
        usernameField.setFont(new Font("SansSerif", Font.PLAIN, 14));

        g.gridwidth = 1;
        g.gridy = 2; g.gridx = 0; add(uLabel, g);
             g.gridx = 1; add(usernameField, g);

        // password
        JLabel pLabel = new JLabel("Password:");
        pLabel.setForeground(Color.WHITE);
        pLabel.setFont(new Font("SansSerif", Font.BOLD, 14));
        passwordField = new JPasswordField(16);
        passwordField.setFont(new Font("SansSerif", Font.PLAIN, 14));

        g.gridy = 3; g.gridx = 0; add(pLabel, g);
             g.gridx = 1; add(passwordField, g);

        // buttons
        JPanel btnRow = new JPanel(new FlowLayout(FlowLayout.CENTER, 8, 0));
        btnRow.setOpaque(false);

        JButton loginBtn    = new JButton("Login");
        JButton registerBtn = new JButton("Register");
        JButton backBtn     = new JButton("← Back");

        styleButton(loginBtn,    new Color(143, 122, 102));
        styleButton(registerBtn, new Color(143, 122, 102));
        styleButton(backBtn,     new Color(110, 100, 90));

        btnRow.add(loginBtn);
        btnRow.add(registerBtn);
        btnRow.add(backBtn);

        g.gridx = 0; g.gridy = 4; g.gridwidth = 2; g.insets = new Insets(18, 6, 4, 6);
        add(btnRow, g);

        // status
        statusLabel = new JLabel(" ", SwingConstants.CENTER);
        statusLabel.setFont(new Font("SansSerif", Font.PLAIN, 13));
        statusLabel.setForeground(new Color(255, 180, 180));
        g.gridy = 5;
        add(statusLabel, g);

        // wire
        loginBtn.addActionListener(this::onLogin);
        registerBtn.addActionListener(this::onRegister);
        backBtn.addActionListener(e -> { if (onBack != null) onBack.run(); });

        ActionListener enter = this::onLogin;
        usernameField.addActionListener(enter);
        passwordField.addActionListener(enter);
    }

    private void styleButton(JButton b, Color bg) {
        b.setBackground(bg);
        b.setForeground(Color.WHITE);
        b.setFont(new Font("SansSerif", Font.BOLD, 14));
        b.setFocusable(false);
        b.setPreferredSize(new Dimension(120, 36));
        b.setCursor(Cursor.getPredefinedCursor(Cursor.HAND_CURSOR));
    }

    private void onLogin(ActionEvent e) {
        String user = usernameField.getText().trim();
        String pass = new String(passwordField.getPassword());
        if (user.isEmpty() || pass.isEmpty()) { statusLabel.setText("Enter username and password"); return; }
        int id = db.login(user, pass);
        if (id < 0) { statusLabel.setText("Invalid username or password"); return; }
        SoundManager.merge();
        authUserId    = id;
        authUsername  = user;
        authUser = new User(id, user);
        onBack = onAuthenticated; // in case user pressed login
        statusLabel.setText("Welcome, " + user + "!");
        if (onAuthenticated != null) onAuthenticated.run();
    }

    private void onRegister(ActionEvent e) {
        String user = usernameField.getText().trim();
        String pass = new String(passwordField.getPassword());
        if (user.isEmpty() || pass.isEmpty()) { statusLabel.setText("Enter username and password"); return; }
        int id = db.register(user, pass);
        if (id < 0) { statusLabel.setText("Username already taken"); return; }
        SoundManager.merge();
        statusLabel.setText("Registered! You can log in now.");
    }

    public int getAuthUserId()          { return authUserId; }
    public String getAuthUsername()     { return authUsername; }

    private User authUser = null;
    public User getAuthenticatedUser()  { return authUser; }
}
