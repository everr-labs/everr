import { describe, expect, it } from "vite-plus/test";
import { buildNodeGraph } from "./node-graph-data";
import { nodeGraphSpec } from "./spec";

function specWith(overrides: Record<string, unknown> = {}) {
  return nodeGraphSpec.parse(overrides);
}

describe("buildNodeGraph", () => {
  it("builds nodes and edges from default columns", () => {
    const model = buildNodeGraph(
      [
        [
          { source: "web", target: "api", value: 10 },
          { source: "api", target: "db", value: 4 },
        ],
      ],
      specWith(),
    );
    expect(model.edges).toEqual([
      { source: "web", target: "api", value: 10, hasValue: true },
      { source: "api", target: "db", value: 4, hasValue: true },
    ]);
    expect(model.nodes).toEqual([
      { id: "web", value: 10, inEdges: 0, outEdges: 1 },
      { id: "api", value: 10, inEdges: 1, outEdges: 1 },
      { id: "db", value: 4, inEdges: 1, outEdges: 0 },
    ]);
    expect(model.droppedRows).toBe(0);
    expect(model.hiddenNodes).toBe(0);
  });

  it("reads custom source/target/value columns", () => {
    const model = buildNodeGraph(
      [[{ caller: "a", callee: "b", calls: 3 }]],
      specWith({
        sourceColumn: "caller",
        targetColumn: "callee",
        valueColumn: "calls",
      }),
    );
    expect(model.edges).toEqual([{ source: "a", target: "b", value: 3, hasValue: true }]);
  });

  it("falls back to the first two columns and first numeric column", () => {
    const model = buildNodeGraph([[{ from: "a", to: "b", note: "x", n: "7" }]], specWith());
    expect(model.edges).toEqual([{ source: "a", target: "b", value: 7, hasValue: true }]);
  });

  it("weighs every edge 1 when there is no numeric column", () => {
    const model = buildNodeGraph(
      [
        [
          { source: "a", target: "b" },
          { source: "a", target: "b" },
          { source: "b", target: "c" },
        ],
      ],
      specWith(),
    );
    expect(model.edges).toEqual([
      { source: "a", target: "b", value: 2, hasValue: false },
      { source: "b", target: "c", value: 1, hasValue: false },
    ]);
  });

  it("sums duplicate (source, target) pairs across frames and keeps directions distinct", () => {
    const model = buildNodeGraph(
      [
        [
          { source: "a", target: "b", value: 1 },
          { source: "b", target: "a", value: 5 },
        ],
        [{ source: "a", target: "b", value: 2 }],
      ],
      specWith(),
    );
    expect(model.edges).toEqual([
      { source: "a", target: "b", value: 3, hasValue: true },
      { source: "b", target: "a", value: 5, hasValue: true },
    ]);
  });

  it("drops rows with missing endpoints and self-loops, counting them", () => {
    const model = buildNodeGraph(
      [
        [
          { source: "a", target: "b", value: 1 },
          { source: null, target: "b", value: 1 },
          { source: "a", target: "", value: 1 },
          { source: "a", target: "a", value: 1 },
        ],
      ],
      specWith(),
    );
    expect(model.edges).toHaveLength(1);
    expect(model.droppedRows).toBe(3);
  });

  it("trims to the maxNodes highest-value nodes and their edges", () => {
    const model = buildNodeGraph(
      [
        [
          { source: "a", target: "hub", value: 5 },
          { source: "b", target: "hub", value: 6 },
          { source: "hub", target: "leaf", value: 1 },
        ],
      ],
      specWith({ maxNodes: 2 }),
    );
    // hub's value is its larger side, 11 in (not 11 + 1), so it outranks b (6)
    expect(model.nodes.map((n) => [n.id, n.value])).toEqual([
      ["hub", 11],
      ["b", 6],
    ]);
    expect(model.edges).toEqual([{ source: "b", target: "hub", value: 6, hasValue: true }]);
    expect(model.hiddenNodes).toBe(2);
  });

  it("reduces each stat its own way into edges and the nodes they call", () => {
    const model = buildNodeGraph(
      [
        [
          { source: "web", target: "api", value: 90, errors: 9, p90: 100, retries: 1 },
          { source: "web", target: "api", value: 10, errors: 1, p90: 200, retries: 2 },
          { source: "worker", target: "api", value: 100, errors: 0, p90: 50, retries: 0 },
        ],
      ],
      specWith({
        stats: [
          { column: "errors", reduce: "rate" },
          { column: "p90" },
          { column: "retries", reduce: "sum" },
        ],
      }),
    );
    const values = (health?: { stats: { column: string; value: number }[] }) =>
      Object.fromEntries((health?.stats ?? []).map((s) => [s.column, s.value]));
    // rate: failed over calls; mean: averaged by calls; sum: added up.
    expect(values(model.edges.find((e) => e.source === "web")?.health)).toEqual({
      errors: 0.1,
      p90: 110,
      retries: 3,
    });
    // The stat columns are never taken for the value.
    expect(model.edges.find((e) => e.source === "web")?.value).toBe(100);
    expect(values(model.nodes.find((n) => n.id === "api")?.health)).toEqual({
      errors: 0.05,
      p90: 80,
      retries: 3,
    });
    // Nothing calls web, so it has no stats of its own.
    expect(model.nodes.find((n) => n.id === "web")?.health).toBeUndefined();
  });

  it("grades stats against their thresholds, and takes the worst level", () => {
    const health = (stats: object[]) =>
      buildNodeGraph(
        [[{ source: "a", target: "b", value: 100, errors: 3, p90: 300 }]],
        specWith({ stats }),
      ).edges[0]?.health;
    const errors = { column: "errors", reduce: "rate", thresholds: [0.01, 0.05] };
    expect(health([errors])?.level).toBe("warning");
    // Without thresholds a stat is shown but grades nothing.
    expect(health([errors, { column: "p90" }])?.stats[1]?.level).toBeUndefined();
    expect(health([errors, { column: "p90", thresholds: [100, 250] }])?.level).toBe("critical");
    // Falling thresholds flag low values.
    expect(health([{ column: "p90", thresholds: [500, 200] }])?.level).toBe("warning");
  });
});
