import { describe, expect, it } from "vitest";
import type { Span } from "@/data/runs/schemas";
import {
  buildSpanTree,
  flattenTree,
  getParentSpanIds,
  stringToColor,
} from "./trace-waterfall-utils";

function makeSpan(overrides: Partial<Span> & { spanId: string }): Span {
  return {
    parentSpanId: "",
    name: "test",
    startTime: 0,
    endTime: 1000,
    duration: 1000,
    conclusion: "success",
    ...overrides,
  };
}

describe("buildSpanTree", () => {
  it("returns empty array for no spans", () => {
    expect(buildSpanTree([])).toEqual([]);
  });

  it("creates root nodes for spans without parents", () => {
    const roots = buildSpanTree([
      makeSpan({ spanId: "a", name: "root1" }),
      makeSpan({ spanId: "b", name: "root2" }),
    ]);
    expect(roots).toHaveLength(2);
    expect(roots[0].depth).toBe(0);
    expect(roots[1].depth).toBe(0);
  });

  it("builds parent-child relationships", () => {
    const roots = buildSpanTree([
      makeSpan({ spanId: "parent", name: "Parent" }),
      makeSpan({
        spanId: "child",
        parentSpanId: "parent",
        name: "Child",
      }),
    ]);
    expect(roots).toHaveLength(1);
    expect(roots[0].children).toHaveLength(1);
    expect(roots[0].children[0].name).toBe("Child");
  });

  it("sets correct depths", () => {
    const roots = buildSpanTree([
      makeSpan({ spanId: "a" }),
      makeSpan({ spanId: "b", parentSpanId: "a" }),
      makeSpan({ spanId: "c", parentSpanId: "b" }),
    ]);
    expect(roots[0].depth).toBe(0);
    expect(roots[0].children[0].depth).toBe(1);
    expect(roots[0].children[0].children[0].depth).toBe(2);
  });

  it("handles orphan spans as roots", () => {
    const roots = buildSpanTree([
      makeSpan({ spanId: "child", parentSpanId: "nonexistent" }),
    ]);
    expect(roots).toHaveLength(1);
    expect(roots[0].depth).toBe(0);
  });
});

describe("flattenTree", () => {
  it("flattens a tree in order", () => {
    const roots = buildSpanTree([
      makeSpan({ spanId: "a", startTime: 1 }),
      makeSpan({ spanId: "b", parentSpanId: "a", startTime: 2 }),
      makeSpan({ spanId: "c", parentSpanId: "a", startTime: 3 }),
    ]);

    const flat = flattenTree(roots, new Set());
    expect(flat.map((n) => n.spanId)).toEqual(["a", "b", "c"]);
  });

  it("sorts by start time", () => {
    const roots = buildSpanTree([
      makeSpan({ spanId: "b", startTime: 200 }),
      makeSpan({ spanId: "a", startTime: 100 }),
    ]);

    const flat = flattenTree(roots, new Set());
    expect(flat[0].spanId).toBe("a");
    expect(flat[1].spanId).toBe("b");
  });

  it("skips children of collapsed nodes", () => {
    const roots = buildSpanTree([
      makeSpan({ spanId: "a", startTime: 1 }),
      makeSpan({ spanId: "b", parentSpanId: "a", startTime: 2 }),
      makeSpan({ spanId: "c", parentSpanId: "b", startTime: 3 }),
    ]);

    const flat = flattenTree(roots, new Set(["a"]));
    expect(flat.map((n) => n.spanId)).toEqual(["a"]);
  });

  it("only collapses specified nodes", () => {
    const roots = buildSpanTree([
      makeSpan({ spanId: "a", startTime: 1 }),
      makeSpan({ spanId: "b", parentSpanId: "a", startTime: 2 }),
      makeSpan({ spanId: "c", parentSpanId: "b", startTime: 3 }),
    ]);

    // Collapse "b" but not "a"
    const flat = flattenTree(roots, new Set(["b"]));
    expect(flat.map((n) => n.spanId)).toEqual(["a", "b"]);
  });
});

describe("getParentSpanIds", () => {
  it("returns empty set for no nodes", () => {
    expect(getParentSpanIds([])).toEqual(new Set());
  });

  it("returns empty set for leaf nodes", () => {
    const roots = buildSpanTree([makeSpan({ spanId: "a" })]);
    expect(getParentSpanIds(roots)).toEqual(new Set());
  });

  it("identifies parent nodes", () => {
    const roots = buildSpanTree([
      makeSpan({ spanId: "a" }),
      makeSpan({ spanId: "b", parentSpanId: "a" }),
      makeSpan({ spanId: "c", parentSpanId: "a" }),
    ]);

    const parents = getParentSpanIds(roots);
    expect(parents.has("a")).toBe(true);
    expect(parents.has("b")).toBe(false);
    expect(parents.has("c")).toBe(false);
  });

  it("identifies nested parents", () => {
    const roots = buildSpanTree([
      makeSpan({ spanId: "a" }),
      makeSpan({ spanId: "b", parentSpanId: "a" }),
      makeSpan({ spanId: "c", parentSpanId: "b" }),
    ]);

    const parents = getParentSpanIds(roots);
    expect(parents.has("a")).toBe(true);
    expect(parents.has("b")).toBe(true);
    expect(parents.has("c")).toBe(false);
  });
});

describe("stringToColor", () => {
  it("returns an HSL color string", () => {
    const color = stringToColor("test");
    expect(color).toMatch(/^hsl\(\d+, 65%, 55%\)$/);
  });

  it("returns consistent colors for the same input", () => {
    expect(stringToColor("hello")).toBe(stringToColor("hello"));
  });

  it("returns different colors for different inputs", () => {
    expect(stringToColor("foo")).not.toBe(stringToColor("bar"));
  });
});
