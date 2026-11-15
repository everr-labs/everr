import { readableForeground } from "@everr/ui/lib/contrast";
import { serviceColor } from "../shared/service-color";

// Canvas fillStyle does not resolve var() expressions. The computed style object
// is live, so subsequent draws pick up changes to the shared theme tokens.
let rootStyle: CSSStyleDeclaration | undefined;

export function resolveThemeColor(color: string): string {
  const property = color.match(/^var\((--[\w-]+)\)$/)?.[1];
  if (!property || typeof document === "undefined") return color;
  rootStyle ??= getComputedStyle(document.documentElement);
  return rootStyle.getPropertyValue(property).trim() || "#9ca3af";
}

export function canvasServiceColor(group: string, colors: ReadonlyMap<string, string>): string {
  return resolveThemeColor(colors.get(group) ?? serviceColor(group));
}

/** Opacity of the destructive wash painted over an error span's bar. */
export const ERROR_TINT_OPACITY = 0.3;

const textColors = new Map<string, string>();
let probe: CanvasRenderingContext2D | null | undefined;

/** Black or white, whichever reads better on a span bar, including the
 *  destructive wash an error span gets on top. */
export function spanTextColor(color: string, hasError = false): string {
  const background = resolveThemeColor(color);
  const key = `${background}|${hasError}`;
  let text = textColors.get(key);
  if (text) return text;
  const tints = hasError
    ? [{ color: toRgb(resolveThemeColor("var(--destructive)")), opacity: ERROR_TINT_OPACITY }]
    : [];
  text = readableForeground(toRgb(background), tints)?.color ?? "#fff";
  textColors.set(key, text);
  return text;
}

// The palette is OKLCH, which the contrast check cannot parse, so the browser
// converts it: paint one pixel and read it back.
function toRgb(color: string): string {
  if (probe === undefined) {
    try {
      probe = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
    } catch {
      probe = null;
    }
  }
  if (!probe) return color;
  try {
    probe.clearRect(0, 0, 1, 1);
    probe.fillStyle = color;
    probe.fillRect(0, 0, 1, 1);
    const [r, g, b] = probe.getImageData(0, 0, 1, 1).data;
    return `rgb(${r}, ${g}, ${b})`;
  } catch {
    return color;
  }
}
