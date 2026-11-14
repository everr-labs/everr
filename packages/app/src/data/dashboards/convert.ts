import type { LayoutItem } from "react-grid-layout";
import { type GridItem, PANEL_REF_PREFIX } from "./schema";

function panelKeyFromRef(ref: string): string {
  return ref.slice(PANEL_REF_PREFIX.length);
}

export function persesToRGL(items: GridItem[]): LayoutItem[] {
  return items.map((item) => ({
    i: panelKeyFromRef(item.content.$ref),
    x: item.x,
    y: item.y,
    w: item.width,
    h: item.height,
  }));
}

/**
 * The layout for a pane too narrow for side-by-side panels: every panel at the
 * full width, one under the other in reading order (top to bottom, then left
 * to right within a row), each keeping its authored height. Authored empty rows
 * are dropped: they space panels out across the width, which a column has none of.
 */
export function stackLayout(items: LayoutItem[], cols: number): LayoutItem[] {
  let y = 0;
  return [...items]
    .sort((a, b) => a.y - b.y || a.x - b.x)
    .map((item) => {
      const stacked = { ...item, x: 0, y, w: cols };
      y += item.h;
      return stacked;
    });
}
