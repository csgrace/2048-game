package view;

import util.ColorMap;

import javax.swing.*;
import java.awt.*;

/**
 * Renders a single tile (used by GameView).
 *
 * A tile is a rounded-rectangle whose colour comes from ColorMap based on
 * its value, with a centred number drawn on top.
 */
public class TileView extends JComponent {

    private int value;
    private static final Font FONT_BIG  = new Font("SansSerif", Font.BOLD, 38);
    private static final Font FONT_MED  = new Font("SansSerif", Font.BOLD, 30);
    private static final Font FONT_SMALL= new Font("SansSerif", Font.BOLD, 22);

    public TileView() {
        this.value = 0;
        setOpaque(false);
    }

    public void setValue(int value) {
        this.value = value;
        repaint();
    }

    public int getValue() { return value; }

    @Override
    public void paintComponent(Graphics g) {
        super.paintComponent(g);
        Graphics2D g2 = (Graphics2D) g.create();
        g2.setRenderingHint(RenderingHints.KEY_ANTIALIASING,
                            RenderingHints.VALUE_ANTIALIAS_ON);

        // background
        g2.setColor(ColorMap.background(value));
        g2.fillRoundRect(3, 3, getWidth() - 6, getHeight() - 6, 12, 12);

        // number (skip zero)
        if (value > 0) {
            g2.setColor(ColorMap.text(value));
            Font font = value < 100 ? FONT_BIG
                      : value < 1000 ? FONT_MED
                                     : FONT_SMALL;
            g2.setFont(font);
            String s = String.valueOf(value);
            FontMetrics fm = g2.getFontMetrics();
            int x = (getWidth()  - fm.stringWidth(s)) / 2;
            int y = (getHeight() + fm.getAscent() - fm.getDescent()) / 2;
            g2.drawString(s, x, y);
        }
        g2.dispose();
    }
}
