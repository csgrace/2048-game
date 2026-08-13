package util;

import javax.sound.sampled.*;
import java.io.ByteArrayInputStream;
import java.io.InputStream;

/**
 * Lightweight sound-effect engine (Task 6 – advanced).
 *
 * Generates short tones programmatically so there's no need for external
 * audio files.  Two effects are provided:
 *   • merge   – played when tiles merge
 *   • move    – played on every valid move
 *   • win     – played on victory
 *   • gameover – played when the board is stuck
 *
 * If audio is unavailable on the host system the manager silently no-ops.
 */
public class SoundManager {

    private static final int SAMPLE_RATE = 44100;
    private static volatile boolean muted = false;

    private SoundManager() {}

    public static void setMuted(boolean m) { muted = m; }

    // ------------------------------------------------------------------ public API

    public static void merge()  { playTone(660, 80); }
    public static void move()   { playTone(330, 40); }
    public static void win()    { playTone(880, 200); playTone(1100, 300); }
    public static void lose()   { playTone(220, 150); playTone(165, 250); }

    // ------------------------------------------------------------------ internals

    private static void playTone(int frequency, int durationMs) {
        if (muted) return;
        try {
            byte[] data = generateTone(frequency, durationMs);
            AudioFormat format = new AudioFormat(SAMPLE_RATE, 8, 1, true, true);
            InputStream bais = new ByteArrayInputStream(data);
            AudioInputStream ais = new AudioInputStream(bais, format, data.length);
            Clip clip = AudioSystem.getClip();
            clip.open(ais);
            clip.start();
        } catch (Exception ignored) {
            // audio not available – game still works without sound
        }
    }

    private static byte[] generateTone(int freq, int durationMs) {
        int samples = SAMPLE_RATE * durationMs / 1000;
        byte[] out = new byte[samples];
        double step = 2.0 * Math.PI * freq / SAMPLE_RATE;
        for (int i = 0; i < samples; i++) {
            // simple square-wave-ish tone, with a quick fade-out
            double env = 1.0 - (double) i / samples;
            out[i] = (byte) (Math.signum(Math.sin(step * i)) * 60 * env);
        }
        return out;
    }
}
