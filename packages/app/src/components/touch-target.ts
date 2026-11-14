/**
 * Grows a small icon control's hit area to about 36px without moving its
 * layout: an invisible box around it takes the taps a fingertip misses by a
 * little. Only for icons with room around them, or the boxes overlap.
 */
export const TOUCH_TARGET = "relative after:absolute after:-inset-2.5";
