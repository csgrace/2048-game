import util.DatabaseManager;
import util.SaveManager;
import view.GameFrame;

import javax.swing.*;

/**
 * Entry point for the 2048 project.
 *
 *   1. Tries to connect to PostgreSQL (host/port/db/user/pass from system properties or defaults).
 *   2. Ensures the schema exists.
 *   3. Launches the Swing GUI on the EDT.
 *
 *   If the DB is unreachable we fall back to file-based saves only – the game
 *   is still fully playable in Guest Mode and User Mode.
 */
public class Main {

    public static final String DATA_DIR        = "data";
    public static       String DB_HOST         = "localhost";
    public static       int    DB_PORT         = 5432;
    public static       String DB_NAME         = "game2048";
    public static       String DB_USER         = "postgres";
    public static       String DB_PASS         = "postgres";

    public static void main(String[] args) {
        parseArgs(args);

        DatabaseManager db = null;
        final boolean[] dbOk = {false};
        try {
            db = new DatabaseManager(DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASS);
            dbOk[0] = db.ensureSchema();
            System.out.println("\u2713 Connected to PostgreSQL at " + DB_HOST + ":" + DB_PORT);
        } catch (Throwable t) {
            System.out.println("\u26a0 Could not connect to PostgreSQL \u2013 using file-based storage only.");
            System.out.println("  " + t.getMessage());
        }

        final DatabaseManager finalDb   = dbOk[0] ? db : null;
        final SaveManager     fileSave  = new SaveManager(DATA_DIR);

        SwingUtilities.invokeLater(() -> {
            GameFrame frame = new GameFrame(finalDb, fileSave, dbOk[0]);
            frame.setVisible(true);
        });
    }

    private static void parseArgs(String[] args) {
        // System properties: -Ddb.host=... -Ddb.port=... -Ddb.name=... -Ddb.user=... -Ddb.pass=...
        if (System.getProperty("db.host") != null) DB_HOST = System.getProperty("db.host");
        if (System.getProperty("db.port") != null) DB_PORT = Integer.parseInt(System.getProperty("db.port"));
        if (System.getProperty("db.name") != null) DB_NAME = System.getProperty("db.name");
        if (System.getProperty("db.user") != null) DB_USER = System.getProperty("db.user");
        if (System.getProperty("db.pass") != null) DB_PASS = System.getProperty("db.pass");
    }
}
