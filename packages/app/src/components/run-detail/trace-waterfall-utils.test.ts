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

function makeChain() {
  return buildSpanTree([
    makeSpan({ spanId: "a", startTime: 1 }),
    makeSpan({ spanId: "b", parentSpanId: "a", startTime: 2 }),
    makeSpan({ spanId: "c", parentSpanId: "b", startTime: 3 }),
  ]);
}

describe("buildSpanTree", () => {
  it("nests children under their parent and assigns depths", () => {
    const roots = buildSpanTree([
      makeSpan({ spanId: "a", name: "Root" }),
      makeSpan({ spanId: "b", parentSpanId: "a", name: "Child" }),
      makeSpan({ spanId: "c", parentSpanId: "b", name: "Grandchild" }),
      makeSpan({ spanId: "d", name: "Other Root" }),
    ]);

    expect(roots.map((n) => n.spanId)).toEqual(["a", "d"]);
    expect(roots.map((n) => n.depth)).toEqual([0, 0]);
    expect(roots[0].children.map((n) => n.name)).toEqual(["Child"]);
    expect(roots[0].children[0].depth).toBe(1);
    expect(roots[0].children[0].children[0].depth).toBe(2);
  });

  it("treats spans with an unknown parent as roots", () => {
    const roots = buildSpanTree([
      makeSpan({ spanId: "child", parentSpanId: "nonexistent" }),
    ]);

    expect(roots).toHaveLength(1);
    expect(roots[0].depth).toBe(0);
  });
});

describe("flattenTree", () => {
  it("walks depth-first with siblings ordered by start time", () => {
    const roots = buildSpanTree([
      makeSpan({ spanId: "b", startTime: 200 }),
      makeSpan({ spanId: "a", startTime: 100 }),
      makeSpan({ spanId: "a2", parentSpanId: "a", startTime: 300 }),
      makeSpan({ spanId: "a1", parentSpanId: "a", startTime: 150 }),
    ]);

    expect(flattenTree(roots, new Set()).map((n) => n.spanId)).toEqual([
      "a",
      "a1",
      "a2",
      "b",
    ]);
  });

  it.each([
    { collapsed: [], expected: ["a", "b", "c"] },
    { collapsed: ["a"], expected: ["a"] },
    { collapsed: ["b"], expected: ["a", "b"] },
  ])("stops at collapsed nodes ($collapsed)", ({ collapsed, expected }) => {
    const flat = flattenTree(makeChain(), new Set(collapsed));
    expect(flat.map((n) => n.spanId)).toEqual(expected);
  });
});

describe("getParentSpanIds", () => {
  it("collects nodes with children at any depth, skipping leaves", () => {
    const roots = buildSpanTree([
      makeSpan({ spanId: "a" }),
      makeSpan({ spanId: "b", parentSpanId: "a" }),
      makeSpan({ spanId: "c", parentSpanId: "b" }),
      makeSpan({ spanId: "leaf" }),
    ]);

    expect(getParentSpanIds(roots)).toEqual(new Set(["a", "b"]));
  });
});

describe("stringToColor", () => {
  it("derives a stable hsl color per name", () => {
    expect(stringToColor("hello")).toMatch(/^hsl\(\d+, 65%, 55%\)$/);
    expect(stringToColor("hello")).toBe(stringToColor("hello"));
    expect(stringToColor("foo")).not.toBe(stringToColor("bar"));
  });
});
