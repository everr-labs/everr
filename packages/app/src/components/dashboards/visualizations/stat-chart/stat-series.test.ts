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

  it("emits a placeholder tile for an empty result set", () => {
    const tiles = computeStatTiles([[]], "last");
    expect(tiles).toHaveLength(1);
    expect(tiles[0]).toMatchObject({ frame: 0, label: "", value: undefined });
  });

  it("emits a placeholder for a query with no numeric column", () => {
    const tiles = computeStatTiles(
      [[{ ts: "2026-06-07T00:00:00", value: 5 }], [{ service: "api" }]],
      "last",
    );
    expect(tiles).toHaveLength(2);
    expect(tiles[0]?.value).toBe(5);
    expect(tiles[1]).toMatchObject({ frame: 1, label: "", value: undefined });
  });

  it("records the originating query index on each tile", () => {
    const tiles = computeStatTiles([[{ a: 1, b: 2 }], [{ c: 3 }]], "last");
    expect(tiles.map((t) => t.frame)).toEqual([0, 0, 1]);
  });

  it("drops rows whose timestamp cannot be parsed", () => {
    const tiles = computeStatTiles(
      [
        [
          { ts: "N/A", value: 99 },
          { ts: "2026-06-07T00:00:00", value: 1 },
          { ts: "2026-06-07T00:01:00", value: 3 },
        ],
      ],
      "first",
    );
    // The unparseable row must not become the chronological "first" (it used
    // to land at epoch 0 and sort to the front).
    expect(tiles[0]?.value).toBe(1);
    expect(tiles[0]?.points).toHaveLength(2);
  });

  it("detects a metric that is NULL in the first bucket but numeric later", () => {
    const tiles = computeStatTiles(
      [
        [
          { ts: "2026-06-07T00:00:00", p99: null },
          { ts: "2026-06-07T00:01:00", p99: 12.5 },
        ],
      ],
      "last",
    );
    expect(tiles).toHaveLength(1);
    expect(tiles[0]?.label).toBe("p99");
    expect(tiles[0]?.value).toBe(12.5);
    expect(tiles[0]?.points).toHaveLength(1);
  });

  it("coerces quoted-integer aggregates (ClickHouse) to numbers", () => {
    const tiles = computeStatTiles(
      [
        [
          { ts: "2026-06-07T00:00:00", count: "10" },
          { ts: "2026-06-07T00:01:00", count: "30" },
        ],
      ],
      "last",
    );
    expect(tiles).toHaveLength(1);
    expect(tiles[0]?.label).toBe("count");
    expect(tiles[0]?.value).toBe(30);
    expect(tiles[0]?.points).toHaveLength(2);
  });

  it("coerces a quoted-integer aggregate with no time column", () => {
    const tiles = computeStatTiles([[{ total: "123" }]], "last");
    expect(tiles[0]?.value).toBe(123);
  });
});
