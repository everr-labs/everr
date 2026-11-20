import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";
import { MetricHeatmap } from "./metric-heatmap";

const setOption = vi.fn();
vi.mock("@everr/ui/hooks/use-echart", () => ({
  useEChart: () => ({ chart: { setOption }, theme: { textColor: "", fontFamily: "" } }),
  resolveCssColor: () => "",
}));

function rowLabels(bounds: number[]) {
  render(
    <MetricHeatmap
      heatmap={{ bounds, counts: [bounds.map(() => 1).concat(1)] }}
      labels={[""]}
      titles={[""]}
      unit="s"
    />,
  );
  return setOption.mock.lastCall?.[0].yAxis.data as string[];
}

describe("MetricHeatmap", () => {
  it("keeps short labels when two rows share a bound", () => {
    // An exponential histogram with negative values: the empty gap before
    // zero and the zero bucket both end at 0.
    expect(rowLabels([-1.29684, -1.18921, 0, 0, 2.37841])).toEqual([
      "≤ -1.3 s",
      "≤ -1.19 s",
      "≤ 0 s",
      "≤ 0 s",
      "≤ 2.38 s",
      "> 2.38 s",
    ]);
  });

  it("adds digits where neighbouring bounds would read the same", () => {
    expect(rowLabels([1.0001, 1.0002])).toEqual(["≤ 1.0001 s", "≤ 1.0002 s", "> 1.0002 s"]);
  });
});
