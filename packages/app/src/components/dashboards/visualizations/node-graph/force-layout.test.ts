import { describe, expect, it } from "vite-plus/test";
import { layoutGraph } from "./force-layout";

const EDGES = [
  { source: "a", target: "b" },
  { source: "b", target: "c" },
  { source: "a", target: "c" },
];

describe("layoutGraph", () => {
  it("centers a single node", () => {
    const pos = layoutGraph(["only"], [], 960, 540, 40);
    expect(pos.get("only")).toEqual({ x: 480, y: 270 });
  });

  it("keeps every node inside the padded box", () => {
    const ids = ["a", "b", "c", "d", "e"];
    const pos = layoutGraph(ids, EDGES, 960, 540, 40);
    for (const id of ids) {
      const p = pos.get(id)!;
      expect(p.x).toBeGreaterThanOrEqual(40);
      expect(p.x).toBeLessThanOrEqual(920);
      expect(p.y).toBeGreaterThanOrEqual(40);
      expect(p.y).toBeLessThanOrEqual(500);
    }
  });

  it("is deterministic and separates nodes", () => {
    const ids = ["a", "b", "c"];
    const first = layoutGraph(ids, EDGES, 960, 540, 40);
    const second = layoutGraph(ids, EDGES, 960, 540, 40);
    expect(second).toEqual(first);
    const [a, b] = [first.get("a")!, first.get("b")!];
    expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(10);
  });
});
