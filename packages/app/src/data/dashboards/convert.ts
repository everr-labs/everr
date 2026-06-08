import type { LayoutItem } from "react-grid-layout";
import type { GridItem } from "./schema";

const REF_PREFIX = "#/spec/panels/";

export function panelKeyFromRef(ref: string): string {
  return ref.slice(REF_PREFIX.length);
}

export function panelRefFromKey(key: string): string {
  return `${REF_PREFIX}${key}`;
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
 * Layout-equality check keyed by panel ref and geometry, ignoring item order
 * (a grid item's position is defined by its x/y/width/height, not its index).
 * Used to distinguish a real drag/resize from react-grid-layout's no-op
 * `onLayoutChange` callbacks on mount/measure, which would otherwise mark the
 * dashboard dirty without any user edit.
 */
export function sameLayoutItems(a: GridItem[], b: GridItem[]): boolean {
  if (a.length !== b.length) return false;
  const key = (it: GridItem) =>
    `${it.content.$ref}:${it.x},${it.y},${it.width},${it.height}`;
  const inA = new Set(a.map(key));
  return b.every((it) => inA.has(key(it)));
}

export function rglToPerses(layout: LayoutItem[]): GridItem[] {
  return layout.map((l) => ({
    x: l.x,
    y: l.y,
    width: l.w,
    height: l.h,
    content: { $ref: panelRefFromKey(l.i) },
  }));
}
