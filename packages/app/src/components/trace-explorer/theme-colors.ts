import { serviceColor } from "@everr/telemetry-explorer/traces";

export type ColorPair = { color: string; colorDark: string };

// Canvas fillStyle does not resolve var() expressions. The computed style object
// is live, so subsequent draws pick up changes to the shared theme tokens.
let rootStyle: CSSStyleDeclaration | undefined;

export function resolveThemeColor(color: string): string {
  const property = color.match(/^var\((--[\w-]+)\)$/)?.[1];
  if (!property || typeof document === "undefined") return color;
  rootStyle ??= getComputedStyle(document.documentElement);
  return rootStyle.getPropertyValue(property).trim() || "#9ca3af";
}

export function canvasColorPair(group: string): ColorPair {
  const color = resolveThemeColor(serviceColor(group));
  return { color, colorDark: color };
}
