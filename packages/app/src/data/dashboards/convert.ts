import type { LayoutItem } from "react-grid-layout";
import { type GridItem, PANEL_REF_PREFIX } from "./schema";

export function panelKeyFromRef(ref: string): string {
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
