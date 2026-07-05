import { queryLabel, SERIES_COLORS, toNumber } from "../data-utils";
import type { QueryResultRow } from "../index";
import type { TreemapSpec } from "./spec";

/** Muted fill for the collapsed "Other" tile — outside the series palette so
 *  it never reads as a real group or series. */
export const OTHER_COLOR = "hsl(215, 14%, 50%)";

export interface TreemapTile {
  name: string;
  /** Group label (groupColumn value, or query label for multi-query results). */
  group: string | undefined;
  value: number;
  color: string;
}

export interface TreemapModel {
  /** Sorted by value descending — the canonical treemap layout order. */
  tiles: TreemapTile[];
  /** Distinct group labels in first-seen order (legend order). */
  groups: string[];
  /** Rows the result contained but the treemap could not place. */
  dropped: number;
}

/**
 * Tiles from every frame's rows. Rows with a missing name, a missing group
 * (when groupColumn is set), or a non-positive value are dropped — a treemap
 * tile's area must be positive. Rows hitting the same (group, name) sum, so
 * additive metrics (counts, bytes, durations) merge naturally.
 *
 * Color encodes the group: groupColumn value when set, else the query for
 * multi-query results. Ungrouped single-query tiles cycle the palette per
 * tile so neighbors stay distinguishable.
 */
export function buildTreemapTiles(frames: QueryResultRow[][], spec: TreemapSpec): TreemapModel {
  interface Acc {
    name: string;
    group: string | undefined;
    value: number;
  }
  const byQuery = spec.groupColumn === undefined && frames.length > 1;
  const acc = new Map<string, Acc>();
  const groups: string[] = [];
  let dropped = 0;

  frames.forEach((rows, frame) => {
    for (const row of rows) {
      const rawName = row[spec.nameColumn];
      const value = toNumber(row[spec.valueColumn]);
      let group: string | undefined;
      if (spec.groupColumn !== undefined) {
        const rawGroup = row[spec.groupColumn];
        if (rawGroup == null) {
          dropped++;
          continue;
        }
        group = String(rawGroup);
      } else if (byQuery) {
        group = queryLabel(frame);
      }
      if (rawName == null || value === null || value <= 0) {
        dropped++;
        continue;
      }
      if (group !== undefined && !groups.includes(group)) groups.push(group);
      const name = String(rawName);
      const key = `${group ?? ""}\u0000${name}`;
      const a = acc.get(key);
      if (a) a.value += value;
      else acc.set(key, { name, group, value });
    }
  });

  const fallback = SERIES_COLORS[0] as string;
  let tiles = [...acc.values()]
    .sort((a, b) => b.value - a.value)
    .map((t, i) => {
      const colorIndex = t.group === undefined ? i : groups.indexOf(t.group);
      return {
        ...t,
        color: SERIES_COLORS[colorIndex % SERIES_COLORS.length] ?? fallback,
      };
    });

  // Collapse the tail past maxTiles into one "Other" tile — but only when it
  // would absorb at least two tiles (replacing one tile with "Other" of the
  // same value would lose information for nothing).
  if (spec.maxTiles !== undefined && tiles.length > spec.maxTiles) {
    const tail = tiles.slice(spec.maxTiles - 1);
    const other: TreemapTile = {
      name: `Other (${tail.length})`,
      group: undefined,
      value: tail.reduce((sum, t) => sum + t.value, 0),
      color: OTHER_COLOR,
    };
    tiles = [...tiles.slice(0, spec.maxTiles - 1), other].sort((a, b) => b.value - a.value);
  }

  return { tiles, groups, dropped };
}
