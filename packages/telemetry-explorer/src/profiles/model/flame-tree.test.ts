import { describe, expect, it } from "vite-plus/test";
import {
  buildFlameTree,
  findNodeByPath,
  type FlameNode,
  functionStats,
  nodePath,
  type ProfileStack,
  rowToStack,
  stacksUnder,
} from "./flame-tree";

function stack(names: string[], value: number): ProfileStack {
  return { frames: names.map((name) => ({ name, file: "", line: 0 })), value };
}

function child(node: FlameNode, name: string): FlameNode {
  const found = node.children.find((c) => c.name === name);
  if (!found) throw new Error(`no child ${name} under ${node.name}`);
  return found;
}

describe("rowToStack", () => {
  it("reverses the leaf-first storage order into root-first frames", () => {
    const result = rowToStack({
      functionNames: ["leaf", "middle", "main"],
      fileNames: ["leaf.go", "middle.go", "main.go"],
      lineNumbers: [3, 2, 1],
      mappingFileNames: ["", "", ""],
      addresses: ["", "", ""],
      value: "7",
    });
    expect(result).toEqual({
      frames: [
        { name: "main", file: "main.go", line: 1 },
        { name: "middle", file: "middle.go", line: 2 },
        { name: "leaf", file: "leaf.go", line: 3 },
      ],
      value: 7,
    });
  });

  it("labels unsymbolized frames by address, then by mapping", () => {
    const { frames } = rowToStack({
      functionNames: ["", "", "main"],
      fileNames: [],
      lineNumbers: [],
      mappingFileNames: ["libc.so.6", "libssl.so.3", ""],
      addresses: ["00", "0004A0F3", ""],
      value: 1,
    });
    expect(frames.map((f) => [f.name, f.file])).toEqual([
      ["main", ""],
      ["0x4a0f3", "libssl.so.3"],
      ["libc.so.6", "libc.so.6"],
    ]);
  });
});

describe("buildFlameTree", () => {
  it("merges shared prefixes and separates self from total", () => {
    const { root, maxDepth } = buildFlameTree([
      stack(["main", "handle", "parse"], 5),
      stack(["main", "handle"], 3),
      stack(["main", "gc"], 2),
    ]);
    const main = child(root, "main");
    const handle = child(main, "handle");
    expect(root.total).toBe(10);
    expect([main.total, main.self]).toEqual([10, 0]);
    expect([handle.total, handle.self]).toEqual([8, 3]);
    expect([child(handle, "parse").total, child(handle, "parse").self]).toEqual([5, 5]);
    expect(maxDepth).toBe(3);
  });

  it("lays children out heaviest first from the parent's start", () => {
    const { root } = buildFlameTree([stack(["main", "light"], 1), stack(["main", "heavy"], 4)]);
    const main = child(root, "main");
    expect(main.children.map((c) => [c.name, c.start])).toEqual([
      ["heavy", 0],
      ["light", 4],
    ]);
  });

  it("keeps the line only when every merged frame agrees", () => {
    const { root } = buildFlameTree([
      { frames: [{ name: "main", file: "main.go", line: 10 }], value: 1 },
      { frames: [{ name: "main", file: "main.go", line: 12 }], value: 1 },
      { frames: [{ name: "init", file: "main.go", line: 4 }], value: 1 },
    ]);
    expect(child(root, "main").line).toBe(0);
    expect(child(root, "init").line).toBe(4);
  });

  it("resolves a zoom path against a rebuilt tree, falling back to the deepest match", () => {
    const stacks = [stack(["main", "handle", "parse"], 1)];
    const parse = child(child(child(buildFlameTree(stacks).root, "main"), "handle"), "parse");
    const rebuilt = buildFlameTree(stacks).root;
    expect(findNodeByPath(rebuilt, nodePath(parse)).name).toBe("parse");
    const other = buildFlameTree([stack(["main", "serve"], 1)]).root;
    expect(findNodeByPath(other, nodePath(parse)).name).toBe("main");
  });
});

describe("functionStats", () => {
  it("counts a recursive function once per stack in its total", () => {
    const stats = functionStats([
      stack(["main", "walk", "walk", "walk"], 4),
      stack(["main", "print"], 1),
    ]);
    const byName = Object.fromEntries(stats.map((s) => [s.name, [s.self, s.total]]));
    expect(byName).toEqual({ main: [0, 5], walk: [4, 4], print: [1, 1] });
  });
});

describe("stacksUnder", () => {
  it("keeps only the stacks through a frame, starting at that frame", () => {
    const stacks = [
      stack(["main", "handle", "parse"], 3),
      stack(["main", "handle"], 2),
      stack(["main", "idle"], 5),
    ];
    const under = stacksUnder(stacks, ["main\u0000", "handle\u0000"]);
    expect(under.map((s) => s.frames.map((f) => f.name))).toEqual([
      ["handle", "parse"],
      ["handle"],
    ]);
    expect(functionStats(under).find((stat) => stat.name === "handle")?.total).toBe(5);
  });
});
