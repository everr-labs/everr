import { describe, expect, it } from "vitest";
import { computeStatTiles } from "./stat-series";

describe("computeStatTiles", () => {
  it("reduces a single time series to one tile", () => {
    const tiles = computeStatTiles(
      [
        [
          { time: "2026-06-07T00:00:00", value: 1 },
          { time: "2026-06-07T00:01:00", value: 3 },
        ],
      ],
      "last",
    );
    expect(tiles).toHaveLength(1);
    expect(tiles[0]?.value).toBe(3);
    expect(tiles[0]?.label).toBe("value");
    expect(tiles[0]?.points).toHaveLength(2);
  });

  it("produces one tile per query", () => {
    const tiles = computeStatTiles(
      [
        [{ ts: "2026-06-07T00:00:00", value: 10 }],
        [{ ts: "2026-06-07T00:00:00", value: 20 }],
      ],
      "last",
    );
    expect(tiles.map((t) => t.value)).toEqual([10, 20]);
  });

  it("produces one tile per numeric column within a query", () => {
    const tiles = computeStatTiles(
      [[{ ts: "2026-06-07T00:00:00", a: 1, b: 2 }]],
      "last",
    );
    expect(tiles.map((t) => t.label)).toEqual(["a", "b"]);
  });

  it("handles value-only rows with no time column", () => {
    const tiles = computeStatTiles([[{ value: 7 }]], "last");
    expect(tiles[0]?.value).toBe(7);
    expect(tiles[0]?.points).toEqual([]);
  });

  it("skips empty result sets", () => {
    expect(computeStatTiles([[]], "last")).toEqual([]);
  });
});
