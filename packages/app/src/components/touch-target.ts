/**
 * Grows a small icon control's hit area to about 36px on touch screens without
 * moving its layout: an invisible box around it takes the taps a fingertip
 * misses by a little. A mouse keeps the icon's own box, so the desktop layout
 * and its hover targets don't change.
 */
export const TOUCH_TARGET =
  "relative pointer-coarse:after:absolute pointer-coarse:after:-inset-2.5";
