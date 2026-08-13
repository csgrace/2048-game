package util;

import model.GameState;

import java.io.*;
import java.io.File;

/**
 * Per-user save / load (Task 3).
 *
 * Convention: one save file per user under <dataDir>/saves/<username>.dat.
 * Saving overwrites the previous file.
 *
 * If the file is corrupt the load method returns null so the caller can start
 * a fresh game instead of crashing.
 */
public class SaveManager {

    private final File savesDir;

    public SaveManager(String dataDir) {
        this.savesDir = new File(dataDir, "saves");
        if (!savesDir.exists()) savesDir.mkdirs();
    }

    private File fileFor(String username) {
        String safe = username.replaceAll("[^A-Za-z0-9._-]", "_");
        return new File(savesDir, safe + ".dat");
    }

    public void save(String username, GameState state) {
        File f = fileFor(username);
        try (ObjectOutputStream oos = new ObjectOutputStream(new FileOutputStream(f))) {
            oos.writeObject(state);
        } catch (IOException ex) {
            System.err.println("Error saving game for " + username + ": " + ex.getMessage());
        }
    }

    public GameState load(String username) {
        File f = fileFor(username);
        if (!f.exists()) return null;
        try (ObjectInputStream ois = new ObjectInputStream(new FileInputStream(f))) {
            Object obj = ois.readObject();
            if (obj instanceof GameState gs) {
                return gs;
            }
        } catch (Exception ex) {
            System.err.println("Warning: corrupt save for " + username + " – ignored.");
        }
        return null;
    }

    public boolean hasSave(String username) {
        return fileFor(username).exists();
    }
}
