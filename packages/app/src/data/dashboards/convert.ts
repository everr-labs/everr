import type { LayoutItem } from "react-grid-layout";
import type { GridItem } from "./schema";

const REF_PREFIX = "#/spec/panels/";

export function panelKeyFromRef(ref: string): string {
  return ref.slice(REF_PREFIX.length);
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
