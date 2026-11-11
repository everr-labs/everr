import { describe, expect, it } from "vite-plus/test";
import type { FlameNode, ProfileStack } from "./flame-tree";
import { buildSandwich } from "./sandwich";

function stack(names: string[], value: number): ProfileStack {
  return { frames: names.map((name) => ({ name, file: "", line: 0 })), value };
}

// Each node as `name:total`, children nested, heaviest first.
function shape(node: FlameNode): unknown {
  const label = `${node.name}:${node.total}`;
  return node.children.length === 0 ? label : { [label]: node.children.map(shape) };
}

const fn = { name: "encode", file: "" };

describe("buildSandwich", () => {
  it("roots the callers and callees at the function, callers growing outward", () => {
    const { callers, callees } = buildSandwich(
      [
        stack(["main", "handleA", "encode", "write"], 6),
        stack(["main", "handleB", "encode"], 3),
        stack(["main", "idle"], 10),
      ],
      fn,
    );
    expect(shape(callers.root)).toEqual({
      "encode:9": [{ "handleA:6": ["main:6"] }, { "handleB:3": ["main:3"] }],
    });
    expect(shape(callees.root)).toEqual({ "encode:9": ["write:6"] });
    expect(callees.root.self).toBe(3);
  });

  it("splits a recursive function at its outermost call, so each stack counts once", () => {
    const { callers, callees } = buildSandwich(
      [stack(["main", "encode", "walk", "encode", "write"], 4)],
      fn,
    );
    expect(shape(callers.root)).toEqual({ "encode:4": ["main:4"] });
    expect(shape(callees.root)).toEqual({
      "encode:4": [{ "walk:4": [{ "encode:4": ["write:4"] }] }],
    });
  });

  it("tells functions of the same name apart by file", () => {
    const { callees } = buildSandwich(
      [
        { frames: [{ name: "encode", file: "a.go", line: 0 }], value: 1 },
        { frames: [{ name: "encode", file: "b.go", line: 0 }], value: 2 },
      ],
      { name: "encode", file: "b.go" },
    );
    expect(callees.root.total).toBe(2);
  });
});
