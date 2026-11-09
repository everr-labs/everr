import { render } from "@testing-library/react";
import * as echarts from "echarts/core";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { BarChartVisualization } from "./bar-chart-visualization";
import { barChartSpec } from "./spec";

// Exercise the real ECharts layout without requiring a browser canvas.
vi.mock("echarts/core", async (importOriginal) => {
  const core = await importOriginal<typeof echarts>();
  const { SVGRenderer } = await import("echarts/renderers");
  core.use([SVGRenderer]);
  return {
    ...core,
    init: vi.fn(() =>
      core.init(null, undefined, { renderer: "svg", ssr: true, width: 600, height: 300 }),
    ),
  };
});

const props = {
  timeRange: { from: new Date("2026-06-07T00:00:00Z"), to: new Date("2026-06-08T00:00:00Z") },
  onTimeRangeChange: () => {},
};

function renderedChart() {
  return vi.mocked(echarts.init).mock.results.at(-1)!.value;
}

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
});

describe("BarChartVisualization", () => {
  it("scales each percent stack to its category's share", () => {
    render(
      <BarChartVisualization
        {...props}
        spec={barChartSpec.parse({ stacking: "percent" })}
        data={[
          [
            { service: "api", ok: 30, error: 10 },
            { service: "web", ok: 5, error: 5 },
          ],
        ]}
      />,
    );

    const chart = renderedChart();
    const { series, yAxis } = chart.getOption();
    expect(series.map((s: { data: number[] }) => s.data)).toEqual([
      [0.75, 0.5],
      [0.25, 0.5],
    ]);
    expect([yAxis[0].min, yAxis[0].max]).toEqual([0, 1]);
  });

  it("stacks by sign and labels each bar readably against its color", () => {
    render(
      <BarChartVisualization
        {...props}
        spec={barChartSpec.parse({
          stacking: "stacked",
          showValues: true,
          colors: { light: "#ffeb3b", dark: "#1a237e" },
        })}
        data={[[{ service: "api", light: 60, dark: 50, lost: -80 }]]}
      />,
    );

    const { series, yAxis } = renderedChart().getOption();
    expect(yAxis[0].min).toBeLessThanOrEqual(-80);
    expect(yAxis[0].max).toBeGreaterThanOrEqual(110);
    expect(series.slice(0, 2).map((s: { label: { color: string } }) => s.label.color)).toEqual([
      "#000",
      "#fff",
    ]);
  });

  it("lists horizontal categories top-down in query order", () => {
    render(
      <BarChartVisualization
        {...props}
        spec={barChartSpec.parse({ orientation: "horizontal" })}
        data={[
          [
            { region: "zeta", value: 1 },
            { region: "alpha", value: 2 },
          ],
        ]}
      />,
    );

    const chart = renderedChart();
    const [zeta, alpha] = [0, 1].map(
      (index) => chart.convertToPixel({ yAxisIndex: 0 }, index) as number,
    );
    expect(zeta).toBeLessThan(alpha!);
    expect(chart.getOption().xAxis[0].type).toBe("value");
  });
});
