import { getContrast, mix, parseToRgba } from "color2k";

export interface BackgroundTint {
  color: string;
  opacity: number;
}

/**
 * Choose the black or white foreground with the best worst-case contrast
 * against an opaque background and any translucent tints painted over it.
 * Returns undefined for colors color2k cannot resolve or composite safely.
 */
export function readableForeground(
  background: string,
  tints: readonly BackgroundTint[] = [],
): { color: "#000" | "#fff"; contrast: number } | undefined {
  try {
    if (parseToRgba(background)[3] !== 1) return undefined;
    const backgrounds = [background];
    for (const { color, opacity } of tints) {
      if (parseToRgba(color)[3] !== 1 || !Number.isFinite(opacity) || opacity < 0 || opacity > 1) {
        return undefined;
      }
      backgrounds.push(mix(background, color, opacity));
    }
    const black = Math.min(...backgrounds.map((color) => getContrast(color, "#000")));
    const white = Math.min(...backgrounds.map((color) => getContrast(color, "#fff")));
    return black >= white ? { color: "#000", contrast: black } : { color: "#fff", contrast: white };
  } catch {
    return undefined;
  }
}
