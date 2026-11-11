import { describe, expect, it } from "vite-plus/test";
import { baselineRange, diffColor, diffFlameTrees, diffFunctionStats } from "./diff";
import { frameId } from "./flame-layout";
import { buildFlameTree, findNodeByPath, functionStats, type ProfileStack } from "./flame-tree";

function stack(names: string[], value: number): ProfileStack {
  return { frames: names.map((name) => ({ name, file: "", line: 0 })), value };
}

const baselineStacks = [stack(["main", "parse"], 50), stack(["main", "render"], 50)];
// Twice the load, and render's share grew from half to three quarters.
const comparisonStacks = [stack(["main", "parse"], 50), stack(["main", "render"], 150)];

describe("diffFlameTrees", () => {
  const comparison = buildFlameTree(comparisonStacks);
  const diffs = diffFlameTrees(comparison, buildFlameTree(baselineStacks));
  const diffAt = (path: string[]) => {
    const node = findNodeByPath(
      comparison.root,
      path.map((name) => `${name}\u0000`),
    );
    return diffs.get(frameId(node));
  };

  it("compares each frame's share of its window, not its raw weight", () => {
    expect(diffAt(["main", "render"])).toEqual({ baseline: 50, comparison: 150, delta: 0.25 });
    expect(diffAt(["main", "parse"])?.delta).toBeCloseTo(-0.25);
    expect(diffAt(["main"])?.delta).toBe(0);
  });

  it("treats a frame missing from the baseline as new", () => {
    const grown = buildFlameTree([...comparisonStacks, stack(["main", "compress"], 200)]);
    const node = findNodeByPath(grown.root, ["main\u0000", "compress\u0000"]);
    const diff = diffFlameTrees(grown, buildFlameTree(baselineStacks)).get(frameId(node));
    expect(diff).toEqual({ baseline: 0, comparison: 200, delta: 0.5 });
  });
});

describe("diffFunctionStats", () => {
  it("keeps functions that only the baseline ran", () => {
    const rows = diffFunctionStats(
      functionStats([stack(["main"], 10)]),
      10,
      functionStats([stack(["main", "legacy"], 10)]),
      10,
    );
    const legacy = rows.find((row) => row.name === "legacy");
    expect(legacy).toMatchObject({ baselineSelf: 10, comparisonSelf: 0, selfDelta: -1 });
  });
});

describe("baselineRange", () => {
  const range = { from: "2026-01-02T10:00:00.000Z", to: "2026-01-02T11:00:00.000Z" };

  it("defaults to the window just before the current one", () => {
    expect(baselineRange(range, "previous")).toEqual({
      from: "2026-01-02T09:00:00.000Z",
      to: "2026-01-02T10:00:00.000Z",
    });
  });

  it("shifts by a week for week-over-week comparisons", () => {
    expect(baselineRange(range, "week").from).toBe("2025-12-26T10:00:00.000Z");
  });
});

describe("diffColor", () => {
  it("marks growth red, shrinkage green, and small changes neutral", () => {
    expect(diffColor(0.2, 0.2)).toMatch(/^hsl\(0 /);
    expect(diffColor(-0.2, 0.2)).toMatch(/^hsl\(145 /);
    expect(diffColor(0.0001, 0.2)).toBe(diffColor(0, 0.2));
  });
});
