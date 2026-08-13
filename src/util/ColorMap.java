package util;

import java.awt.*;
import java.util.HashMap;
import java.util.Map;

/**
 * Maps tile values to their displaying colours for both the tile background
 * and the number text.
 */
public final class ColorMap {

    private ColorMap() {}

    private static final Map<Integer, Color> BG = new HashMap<>();
    private static final Color                      BG_DEFAULT = new Color(60, 58, 50);
    private static final Color                      TEXT_DARK  = new Color(119, 110, 101);
    private static final Color                      TEXT_LIGHT = new Color(249, 246, 242);

    static {
        BG.put(0,    new Color(205, 193, 180));
        BG.put(2,    new Color(238, 228, 218));
        BG.put(4,    new Color(237, 224, 200));
        BG.put(8,    new Color(242, 177, 121));
        BG.put(16,   new Color(245, 149, 99));
        BG.put(32,   new Color(246, 124, 95));
        BG.put(64,   new Color(246, 94, 59));
        BG.put(128,  new Color(237, 207, 114));
        BG.put(256,  new Color(237, 204, 97));
        BG.put(512,  new Color(237, 200, 80));
        BG.put(1024, new Color(237, 197, 63));
        BG.put(2048, new Color(237, 194, 46));
    }

    public static Color background(int value) {
        return BG.getOrDefault(value, BG_DEFAULT);
    }

    public static Color text(int value) {
        return (value <= 4) ? TEXT_DARK : TEXT_LIGHT;
    }
}
