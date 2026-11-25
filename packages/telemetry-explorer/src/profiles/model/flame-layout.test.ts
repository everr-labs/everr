import { describe, expect, it } from "vite-plus/test";
import { buildFlameTree } from "./flame-tree";
import { profileFlamegraph } from "./flame-layout";

const frame = (name: string) => ({ name, file: "main.go", line: 0 });

describe("profileFlamegraph", () => {
  const tree = buildFlameTree([
    { frames: [frame("main"), frame("handler"), frame("compute")], value: 700 },
    { frames: [frame("main"), frame("handler"), frame("encode")], value: 200 },
    { frames: [frame("main"), frame("gc")], value: 100 },
  ]);
  const { layout, nodes, durationMs } = profileFlamegraph(tree);

  it("puts every frame on the row of its call depth", () => {
    expect(layout.visualRows.map((row) => row.map((span) => span.name))).toEqual([
      ["total"],
      ["main"],
      ["handler", "gc"],
      ["compute", "encode"],
    ]);
  });

  it("places siblings side by side by weight, inside their parent", () => {
    const [compute, encode] = layout.visualRows[3]!;
    const handler = layout.visualRows[2]![0]!;
    expect(compute!.timestamp).toBe(handler.timestamp);
    expect(encode!.timestamp).toBe(compute!.timestamp + compute!.durationNano / 1e6);
    expect(compute!.durationNano + encode!.durationNano).toBe(handler.durationNano);
  });

  it("spans the root's total weight and maps every bar back to its frame", () => {
    expect(durationMs).toBe(1000 / 1e6);
    for (const row of layout.visualRows) {
      for (const span of row) expect(nodes.get(span.spanId)?.name).toBe(span.name);
    }
  });
  it("puts the root on the bottom row when inverted", () => {
    const inverted = profileFlamegraph(tree, { inverted: true }).layout;
    expect(inverted.visualRows.map((row) => row.map((span) => span.name))).toEqual([
      ["compute", "encode"],
      ["handler", "gc"],
      ["main"],
      ["total"],
    ]);
  });
});
