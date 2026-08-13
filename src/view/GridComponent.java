package view;

import util.ColorMap;

import javax.swing.*;
import java.awt.*;

/**
 * Renders a single tile: draws its background colour (from ColorMap) and
 * centres the numeric value.
 */
public class GridComponent extends JComponent {

    private int row;
    private int col;
    private int number;

    static Font FONT = new Font("SansSerif", Font.BOLD, 36);

    public GridComponent(int row, int col, int gridSize) {
        this(row, col, 0, gridSize);
    }

    public GridComponent(int row, int col, int number, int gridSize) {
        this.setSize(gridSize, gridSize);
        this.row = row;
        this.col = col;
        this.number = number;
    }

    @Override
    public void paintComponent(Graphics g) {
        super.paintComponent(g);
        Graphics2D g2 = (Graphics2D) g;
        g2.setRenderingHint(RenderingHints.KEY_ANTIALIASING,
                            RenderingHints.VALUE_ANTIALIAS_ON);

        // background
        Color bg = ColorMap.getColor(number);
        g2.setColor(bg);
        g2.fillRoundRect(2, 2, getWidth() - 4, getHeight() - 4, 8, 8);

        // number
        if (number > 0) {
            Color textColor;
            if (number <= 4) {
                textColor = new Color(119, 110, 101);
            } else {
                textColor = Color.WHITE;
            }
            g2.setColor(textColor);
            g2.setFont(FONT);

            String text = String.valueOf(number);
            FontMetrics fm = g2.getFontMetrics();
            int textWidth  = fm.stringWidth(text);
            int textHeight = fm.getAscent();
            int x = (getWidth()  - textWidth)  / 2;
            int y = (getHeight() + textHeight) / 2 - 3;
            g2.drawString(text, x, y);
        }
    }

    public int getRow()                { return row; }
    public void setRow(int row)        { this.row = row; repaint(); }
    public int getCol()                { return col; }
    public void setCol(int col)        { this.col = col; repaint(); }
    public int getNumber()             { return number; }
    public void setNumber(int number)  { this.number = number; repaint(); }
}
