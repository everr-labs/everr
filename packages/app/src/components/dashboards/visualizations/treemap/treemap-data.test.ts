import { describe, expect, it } from "vitest";
import { SERIES_COLORS } from "../data-utils";
import type { QueryResultRow } from "../index";
import { treemapSpec } from "./spec";
import { buildTreemapTiles, OTHER_COLOR } from "./treemap-data";

const spec = (o: Record<string, unknown> = {}) => treemapSpec.parse(o);

describe("buildTreemapTiles", () => {
  it("reads name/value from a single frame, sorted by value descending", () => {
    const frames = [
      [
        { name: "a", value: 1 },
        { name: "b", value: 5 },
        { name: "c", value: 3 },
      ],
    ];
    const { tiles, groups, dropped } = buildTreemapTiles(frames, spec());
    expect(dropped).toBe(0);
    expect(groups).toEqual([]);
    expect(tiles.map((t) => t.name)).toEqual(["b", "c", "a"]);
    expect(tiles.map((t) => t.value)).toEqual([5, 3, 1]);
  });

  it("drops rows with missing names or non-positive/non-numeric values", () => {
    const frames = [
      [
        { name: "ok", value: 2 },
        { name: "zero", value: 0 },
        { name: "negative", value: -3 },
        { name: "nan", value: "x" },
        { name: "null", value: null },
        { value: 4 },
        { name: null, value: 4 },
      ],
    ] as unknown as QueryResultRow[][];
    const { tiles, dropped } = buildTreemapTiles(frames, spec());
    expect(tiles).toHaveLength(1);
    expect(tiles[0]?.name).toBe("ok");
    expect(dropped).toBe(6);
  });

  it("coerces ClickHouse quoted-number strings to numbers", () => {
    const frames = [[{ name: "a", value: "42" }]];
    const { tiles } = buildTreemapTiles(frames, spec());
    expect(tiles[0]?.value).toBe(42);
  });

  it("reads custom column names", () => {
    const frames = [[{ svc: "api", reqs: 9 }]];
    const { tiles } = buildTreemapTiles(
      frames,
      spec({ nameColumn: "svc", valueColumn: "reqs" }),
    );
    expect(tiles).toEqual([
      { name: "api", group: undefined, value: 9, color: SERIES_COLORS[0] },
    ]);
  });

  it("sums duplicate names within the same group", () => {
    const frames = [
      [
        { name: "a", value: 2 },
        { name: "a", value: 3 },
        { name: "b", value: 1 },
      ],
    ];
    const { tiles } = buildTreemapTiles(frames, spec());
    expect(tiles.map((t) => [t.name, t.value])).toEqual([
      ["a", 5],
      ["b", 1],
    ]);
  });

  it("groups and colors tiles by groupColumn, tracking group order", () => {
    const frames = [
      [
        { name: "a", env: "prod", value: 4 },
        { name: "a", env: "dev", value: 2 },
        { name: "b", env: "prod", value: 1 },
      ],
    ];
    const { tiles, groups } = buildTreemapTiles(
      frames,
      spec({ groupColumn: "env" }),
    );
    expect(groups).toEqual(["prod", "dev"]);
    // same name in different groups stays distinct
    expect(tiles.map((t) => [t.name, t.group, t.value])).toEqual([
      ["a", "prod", 4],
      ["a", "dev", 2],
      ["b", "prod", 1],
    ]);
    const colorOf = Object.fromEntries(
      tiles.map((t) => [`${t.group}/${t.name}`, t.color]),
    );
    expect(colorOf["prod/a"]).toBe(SERIES_COLORS[0]);
    expect(colorOf["prod/b"]).toBe(SERIES_COLORS[0]);
    expect(colorOf["dev/a"]).toBe(SERIES_COLORS[1]);
  });

  it("groups by query when there are multiple frames and no groupColumn", () => {
    const frames = [[{ name: "a", value: 1 }], [{ name: "a", value: 2 }]];
    const { tiles, groups } = buildTreemapTiles(frames, spec());
    expect(groups).toEqual(["Query A", "Query B"]);
    expect(tiles.map((t) => [t.name, t.group, t.value])).toEqual([
      ["a", "Query B", 2],
      ["a", "Query A", 1],
    ]);
  });

  it("cycles the palette per tile when ungrouped", () => {
    const rows = Array.from({ length: SERIES_COLORS.length + 1 }, (_, i) => ({
      name: `t${i}`,
      // descending so the input order survives the sort
      value: 100 - i,
    }));
    const { tiles } = buildTreemapTiles([rows], spec());
    expect(tiles[0]?.color).toBe(SERIES_COLORS[0]);
    expect(tiles[1]?.color).toBe(SERIES_COLORS[1]);
    expect(tiles[SERIES_COLORS.length]?.color).toBe(SERIES_COLORS[0]);
  });

  it("groupColumn rows with a null group are dropped", () => {
    const frames = [
      [
        { name: "a", env: "prod", value: 1 },
        { name: "b", env: null, value: 2 },
      ],
    ];
    const { tiles, groups, dropped } = buildTreemapTiles(
      frames,
      spec({ groupColumn: "env" }),
    );
    expect(tiles).toHaveLength(1);
    expect(groups).toEqual(["prod"]);
    expect(dropped).toBe(1);
  });

  describe("maxTiles", () => {
    const rows = [
      { name: "a", value: 100 },
      { name: "b", value: 50 },
      { name: "c", value: 8 },
      { name: "d", value: 5 },
      { name: "e", value: 2 },
    ];

    it("collapses the tail into a single Other tile", () => {
      const { tiles } = buildTreemapTiles([rows], spec({ maxTiles: 3 }));
      expect(tiles.map((t) => [t.name, t.value])).toEqual([
        ["a", 100],
        ["b", 50],
        ["Other (3)", 15],
      ]);
      expect(tiles[2]?.color).toBe(OTHER_COLOR);
      expect(tiles[2]?.group).toBeUndefined();
    });

    it("does not collapse when the tile count fits", () => {
      const { tiles } = buildTreemapTiles([rows], spec({ maxTiles: 5 }));
      expect(tiles).toHaveLength(5);
      expect(tiles.some((t) => t.name.startsWith("Other"))).toBe(false);
    });

    it("never produces an Other tile holding a single tile", () => {
      // 4 tiles, maxTiles 4: collapsing the 4th alone would be pointless
      const { tiles } = buildTreemapTiles(
        [rows.slice(0, 4)],
        spec({ maxTiles: 4 }),
      );
      expect(tiles).toHaveLength(4);
      expect(tiles.some((t) => t.name.startsWith("Other"))).toBe(false);
    });

    it("keeps group colors on kept tiles; Other is ungrouped", () => {
      const grouped = [
        { name: "a", env: "prod", value: 100 },
        { name: "b", env: "dev", value: 50 },
        { name: "c", env: "prod", value: 8 },
        { name: "d", env: "dev", value: 5 },
      ];
      const { tiles, groups } = buildTreemapTiles(
        [grouped],
        spec({ groupColumn: "env", maxTiles: 3 }),
      );
      expect(groups).toEqual(["prod", "dev"]);
      expect(tiles.map((t) => [t.name, t.group, t.value])).toEqual([
        ["a", "prod", 100],
        ["b", "dev", 50],
        ["Other (2)", undefined, 13],
      ]);
      expect(tiles[0]?.color).toBe(SERIES_COLORS[0]);
      expect(tiles[1]?.color).toBe(SERIES_COLORS[1]);
      expect(tiles[2]?.color).toBe(OTHER_COLOR);
    });

    it("re-sorts when the Other tile outweighs kept tiles", () => {
      const skewed = [
        { name: "a", value: 10 },
        { name: "b", value: 9 },
        ...Array.from({ length: 20 }, (_, i) => ({
          name: `t${i}`,
          value: 5,
        })),
      ];
      const { tiles } = buildTreemapTiles([skewed], spec({ maxTiles: 3 }));
      expect(tiles.map((t) => t.name)).toEqual(["Other (20)", "a", "b"]);
      expect(tiles[0]?.value).toBe(100);
    });
  });

  it("returns no tiles for empty frames", () => {
    expect(buildTreemapTiles([], spec())).toEqual({
      tiles: [],
      groups: [],
      dropped: 0,
    });
    expect(buildTreemapTiles([[]], spec())).toEqual({
      tiles: [],
      groups: [],
      dropped: 0,
    });
  });
});
