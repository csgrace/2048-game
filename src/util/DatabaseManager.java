package util;

import model.User;

import java.sql.*;
import java.util.ArrayList;
import java.util.List;

/**
 * PostgreSQL-backed user store + leaderboard (replaces UserManager/SaveManager).
 *
 * Required schema:
 *
 *   CREATE TABLE users (
 *       id            SERIAL PRIMARY KEY,
 *       username      VARCHAR(64) UNIQUE NOT NULL,
 *       password_hash VARCHAR(255) NOT NULL,
 *       created_at    TIMESTAMP DEFAULT now()
 *   );
 *
 *   CREATE TABLE scores (
 *       id         SERIAL PRIMARY KEY,
 *       user_id    INTEGER REFERENCES users(id),
 *       score      INTEGER NOT NULL,
 *       steps      INTEGER NOT NULL,
 *       duration_s INTEGER NOT NULL,
 *       achieved   TIMESTAMP DEFAULT now()
 *   );
 *
 *   CREATE TABLE saves (
 *       user_id     INTEGER PRIMARY KEY REFERENCES users(id),
 *       board       INTEGER[] NOT NULL,
 *       score       INTEGER NOT NULL,
 *       steps       INTEGER NOT NULL,
 *       elapsed_ms  BIGINT NOT NULL,
 *       saved_at    TIMESTAMP DEFAULT now()
 *   );
 */
public class DatabaseManager {

    private final String url;
    private final String dbUser;
    private final String dbPass;

    public DatabaseManager(String host, int port, String db, String user, String pass) {
        this.url     = "jdbc:postgresql://" + host + ":" + port + "/" + db;
        this.dbUser  = user;
        this.dbPass  = pass;
        try { Class.forName("org.postgresql.Driver"); } catch (ClassNotFoundException e) {
            System.err.println("PostgreSQL JDBC driver not found – add postgresql-42.x.jar to classpath");
        }
    }

    private Connection conn() throws SQLException {
        return DriverManager.getConnection(url, dbUser, dbPass);
    }

    // ======================================================================
    //  User management
    // ======================================================================

    /** Simple SHA-256 hash (for demo – use BCrypt in production). */
    public static String hash(String plain) {
        try {
            java.security.MessageDigest md = java.security.MessageDigest.getInstance("SHA-256");
            byte[] digest = md.digest(plain.getBytes(java.nio.charset.StandardCharsets.UTF_8));
            StringBuilder sb = new StringBuilder();
            for (byte b : digest) sb.append(String.format("%02x", b));
            return sb.toString();
        } catch (Exception e) {
            return Integer.toHexString(plain.hashCode());          // fallback
        }
    }

    /**
     * Register. Returns the new user's id, or -1 if username is taken.
     */
    public int register(String username, String password) {
        String sql = "INSERT INTO users(username, password_hash) VALUES(?, ?) RETURNING id";
        try (Connection c = conn(); PreparedStatement ps = c.prepareStatement(sql)) {
            ps.setString(1, username);
            ps.setString(2, hash(password));
            ResultSet rs = ps.executeQuery();
            return rs.next() ? rs.getInt("id") : -1;
        } catch (SQLException e) {
            return -1;                                              // likely duplicate
        }
    }

    /**
     * Authenticate. Returns user id or -1.
     */
    public int login(String username, String password) {
        String sql = "SELECT id FROM users WHERE username = ? AND password_hash = ?";
        try (Connection c = conn(); PreparedStatement ps = c.prepareStatement(sql)) {
            ps.setString(1, username);
            ps.setString(2, hash(password));
            ResultSet rs = ps.executeQuery();
            return rs.next() ? rs.getInt("id") : -1;
        } catch (SQLException e) {
            return -1;
        }
    }

    /** Look up a User (lightweight). */
    public User getUser(int userId) {
        String sql = "SELECT id, username FROM users WHERE id = ?";
        try (Connection c = conn(); PreparedStatement ps = c.prepareStatement(sql)) {
            ps.setInt(1, userId);
            ResultSet rs = ps.executeQuery();
            if (rs.next()) return new User(rs.getInt("id"), rs.getString("username"));
        } catch (SQLException ignored) {}
        return null;
    }

    // ======================================================================
    //  Leaderboard
    // ======================================================================

    public record ScoreRow(String username, int score, int steps, int durationS, int gridSize, Timestamp at) {}

    /** Top-N leaderboard rows for a specific grid size. */
    public List<ScoreRow> leaderboard(int gridSize, int limit) {
        List<ScoreRow> rows = new ArrayList<>();
        String sql = """
            SELECT u.username, s.score, s.steps, s.duration_s, s.grid_size, s.achieved
              FROM scores s JOIN users u ON u.id = s.user_id
             WHERE s.grid_size = ?
             ORDER BY s.score DESC, s.duration_s ASC
             LIMIT ?
            """;
        try (Connection c = conn(); PreparedStatement ps = c.prepareStatement(sql)) {
            ps.setInt(1, gridSize);
            ps.setInt(2, limit);
            ResultSet rs = ps.executeQuery();
            while (rs.next()) rows.add(new ScoreRow(
                rs.getString("username"),
                rs.getInt("score"),
                rs.getInt("steps"),
                rs.getInt("duration_s"),
                rs.getInt("grid_size"),
                rs.getTimestamp("achieved")
            ));
        } catch (SQLException ignored) {}
        return rows;
    }

    /**
     * Record a new score for a specific grid size.
     */
    public void recordScore(int userId, int score, int steps, long elapsedMillis, int gridSize) {
        String sql = "INSERT INTO scores(user_id, score, steps, duration_s, grid_size) VALUES(?,?,?,?,?)";
        try (Connection c = conn(); PreparedStatement ps = c.prepareStatement(sql)) {
            ps.setInt(1, userId);
            ps.setInt(2, score);
            ps.setInt(3, steps);
            ps.setInt(4, (int)(elapsedMillis / 1000));
            ps.setInt(5, gridSize);
            ps.executeUpdate();
        } catch (SQLException ignored) {}
    }

    // ======================================================================
    //  Save / Load (one slot per user, overwrites)
    // ======================================================================

    public void saveGame(int userId, int[][] board, int score, int steps, long elapsedMs) {
        StringBuilder sb = new StringBuilder("{");
        for (int r = 0; r < board.length; r++) {
            for (int c = 0; c < board[r].length; c++) {
                if (r > 0 || c > 0) sb.append(',');
                sb.append(board[r][c]);
            }
        }
        sb.append('}');

        String upsert = """
            INSERT INTO saves(user_id, grid_size, board, score, steps, elapsed_ms)
            VALUES (?, ?, ?::integer[], ?, ?, ?)
            ON CONFLICT (user_id, grid_size)
            DO UPDATE SET board = EXCLUDED.board, score = EXCLUDED.score,
                          steps = EXCLUDED.steps, elapsed_ms = EXCLUDED.elapsed_ms,
                          saved_at = now()
            """;
        try (Connection c = conn(); PreparedStatement ps = c.prepareStatement(upsert)) {
            ps.setInt(1, userId);
            ps.setInt(2, board.length);
            ps.setString(3, sb.toString());
            ps.setInt(4, score);
            ps.setInt(5, steps);
            ps.setLong(6, elapsedMs);
            ps.executeUpdate();
        } catch (SQLException ignored) {}
    }

    public record SaveData(int[][] board, int score, int steps, long elapsedMs) {}

    public SaveData loadGame(int userId, int gridSize) {
        String sql = "SELECT board, score, steps, elapsed_ms FROM saves WHERE user_id = ? AND grid_size = ?";
        try (Connection c = conn(); PreparedStatement ps = c.prepareStatement(sql)) {
            ps.setInt(1, userId);
            ps.setInt(2, gridSize);
            ResultSet rs = ps.executeQuery();
            if (rs.next()) {
                String arr = rs.getString("board");             // "{0,2,4,...}"
                int score = rs.getInt("score");
                int steps = rs.getInt("steps");
                long ms   = rs.getLong("elapsed_ms");
                int[][] board = parseBoard(arr, gridSize);
                return new SaveData(board, score, steps, ms);
            }
        } catch (SQLException ignored) {}
        return null;
    }

    private int[][] parseBoard(String arr, int size) {
        int[][] board = new int[size][size];
        if (arr == null || arr.length() < 2) return board;
        String body = arr.substring(1, arr.length() - 1);       // strip curly braces
        String[] parts = body.split(",");
        for (int i = 0; i < parts.length && i < size * size; i++) {
            int r = i / size, cc = i % size;
            try { board[r][cc] = Integer.parseInt(parts[i].trim()); }
            catch (NumberFormatException ignored) {}
        }
        return board;
    }

    // ======================================================================
    //  Schema bootstrap (run once)
    // ======================================================================

    /**
     * Create tables if they don't already exist.
     * @return true on success, false if the database is unreachable.
     */
    public boolean ensureSchema() {
        String[] ddl = {
            "CREATE TABLE IF NOT EXISTS users ("
            + "id SERIAL PRIMARY KEY,"
            + "username VARCHAR(64) UNIQUE NOT NULL,"
            + "password_hash VARCHAR(255) NOT NULL,"
            + "created_at TIMESTAMP DEFAULT now())",

            "CREATE TABLE IF NOT EXISTS scores ("
            + "id SERIAL PRIMARY KEY,"
            + "user_id INTEGER REFERENCES users(id),"
            + "score INTEGER NOT NULL,"
            + "steps INTEGER NOT NULL,"
            + "duration_s INTEGER NOT NULL,"
            + "grid_size INTEGER NOT NULL DEFAULT 4,"
            + "achieved TIMESTAMP DEFAULT now())",

            "CREATE TABLE IF NOT EXISTS saves ("
            + "user_id INTEGER REFERENCES users(id),"
            + "grid_size INTEGER NOT NULL DEFAULT 4,"
            + "board INTEGER[] NOT NULL,"
            + "score INTEGER NOT NULL,"
            + "steps INTEGER NOT NULL,"
            + "elapsed_ms BIGINT NOT NULL,"
            + "saved_at TIMESTAMP DEFAULT now(),"
            + "PRIMARY KEY(user_id, grid_size))"
        };
        try (Connection c = conn(); Statement st = c.createStatement()) {
            for (String s : ddl) st.executeUpdate(s);
            return true;
        } catch (SQLException e) {
            System.err.println("Schema init failed: " + e.getMessage());
            return false;
        }
    }
}
