package model;

import java.io.Serializable;

/**
 * Simple DTO representing a logged-in user.
 *
 * @param id       database primary key
 * @param username display name (kept as-entered, original case)
 */
public record User(int id, String username) implements Serializable {

    private static final long serialVersionUID = 1L;

    @Override
    public String toString() {
        return "User{id=%d, name=%s}".formatted(id, username);
    }
}
