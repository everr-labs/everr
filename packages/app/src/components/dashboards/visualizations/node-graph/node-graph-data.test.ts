import { describe, expect, it } from "vitest";
import { buildNodeGraph, MAX_LAYOUT_NODES } from "./node-graph-data";
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
      { id: "api", value: 14, inEdges: 1, outEdges: 1 },
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
    expect(model.edges).toEqual([
      { source: "a", target: "b", value: 3, hasValue: true },
    ]);
  });

  it("falls back to the first two columns and first numeric column", () => {
    const model = buildNodeGraph(
      [[{ from: "a", to: "b", note: "x", n: "7" }]],
      specWith(),
    );
    expect(model.edges).toEqual([
      { source: "a", target: "b", value: 7, hasValue: true },
    ]);
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

  it("sums duplicate (source, target) pairs and keeps directions distinct", () => {
    const model = buildNodeGraph(
      [
        [
          { source: "a", target: "b", value: 1 },
          { source: "a", target: "b", value: 2 },
          { source: "b", target: "a", value: 5 },
        ],
      ],
      specWith(),
    );
    expect(model.edges).toEqual([
      { source: "a", target: "b", value: 3, hasValue: true },
      { source: "b", target: "a", value: 5, hasValue: true },
    ]);
  });

  it("merges edges across query frames", () => {
    const model = buildNodeGraph(
      [
        [{ source: "a", target: "b", value: 1 }],
        [{ source: "a", target: "b", value: 2 }],
      ],
      specWith(),
    );
    expect(model.edges).toEqual([
      { source: "a", target: "b", value: 3, hasValue: true },
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
          { source: "big", target: "mid", value: 100 },
          { source: "mid", target: "small", value: 1 },
        ],
      ],
      specWith({ maxNodes: 2 }),
    );
    // mid touches both edges (100 + 1) so it outranks big (100)
    expect(model.nodes.map((n) => n.id)).toEqual(["mid", "big"]);
    expect(model.edges).toEqual([
      { source: "big", target: "mid", value: 100, hasValue: true },
    ]);
    expect(model.hiddenNodes).toBe(1);
  });

  it("caps at the layout limit even without maxNodes", () => {
    const rows = Array.from({ length: MAX_LAYOUT_NODES + 50 }, (_, i) => ({
      source: "hub",
      target: `n${i}`,
      value: i + 1,
    }));
    const model = buildNodeGraph([rows], specWith());
    expect(model.nodes).toHaveLength(MAX_LAYOUT_NODES);
    expect(model.hiddenNodes).toBe(51);
  });

  it("returns an empty model for empty frames", () => {
    const model = buildNodeGraph([[]], specWith());
    expect(model.nodes).toEqual([]);
    expect(model.edges).toEqual([]);
  });
});
