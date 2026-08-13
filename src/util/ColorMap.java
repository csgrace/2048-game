package util;

import java.awt.*;
import java.util.HashMap;
import java.util.Map;

/**
 * Maps tile values to their classic 2048 colours.
 */
public class ColorMap {

    static final Map<Integer, Color> COLOR_MAP = new HashMap<>();

    public static void InitialColorMap() {
        COLOR_MAP.put(0,    new Color(205, 193, 180));   // empty cell
        COLOR_MAP.put(2,    new Color(238, 228, 218));
        COLOR_MAP.put(4,    new Color(237, 224, 200));
        COLOR_MAP.put(8,    new Color(242, 177, 121));
        COLOR_MAP.put(16,   new Color(245, 149, 99));
        COLOR_MAP.put(32,   new Color(246, 124, 95));
        COLOR_MAP.put(64,   new Color(246, 94, 59));
        COLOR_MAP.put(128,  new Color(237, 207, 114));
        COLOR_MAP.put(256,  new Color(237, 204, 97));
        COLOR_MAP.put(512,  new Color(237, 200, 80));
        COLOR_MAP.put(1024, new Color(237, 197, 63));
        COLOR_MAP.put(2048, new Color(237, 194, 46));
    }

    public static Color getColor(int value) {
        return COLOR_MAP.getOrDefault(value, new Color(60, 58, 50));
    }
}
