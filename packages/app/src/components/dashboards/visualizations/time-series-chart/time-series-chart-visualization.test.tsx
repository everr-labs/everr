import { fireEvent, render, screen } from "@testing-library/react";
import * as echarts from "echarts/core";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { timeSeriesChartSpec } from "./spec";
import { TimeSeriesChartVisualization } from "./time-series-chart-visualization";

vi.mock("echarts/core", async (importOriginal) =>
  (await import("@everr/ui/testing/echarts")).ssrEChartsCore(importOriginal),
);

const props = {
  timeRange: {
    from: new Date("2026-06-07T00:00:00Z"),
    to: new Date("2026-06-07T00:02:00Z"),
  },
  onTimeRangeChange: () => {},
};

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
});

describe("TimeSeriesChartVisualization", () => {
  it("fits every signed stack edge and preserves cumulative stacking across zero", () => {
    render(
      <TimeSeriesChartVisualization
        {...props}
        spec={timeSeriesChartSpec.parse({ stacked: true })}
        data={[
          [
            { time: "2026-06-07T00:00:00", a: 100, b: -50 },
            { time: "2026-06-07T00:01:00", a: -100, b: 50 },
          ],
        ]}
      />,
    );

    const chart = vi.mocked(echarts.init).mock.results.at(-1)!.value;
    // ECharts exposes this calculation through its internal model, not getOption().
    const model = chart.getModel();
    const tops = model.getSeries().map(
      (series: {
        getData: () => {
          getCalculationInfo: (key: string) => string;
          get: (dimension: string, index: number) => number;
        };
      }) => {
        const data = series.getData();
        const dimension = data.getCalculationInfo("stackResultDimension");
        return [data.get(dimension, 0), data.get(dimension, 1)];
      },
    );
    expect(tops).toEqual([
      [100, -100],
      [50, -50],
    ]);

    const [axis] = chart.getOption().yAxis;
    expect(axis.min).toBeLessThanOrEqual(-100);
    expect(axis.max).toBeGreaterThanOrEqual(100);
  });

  it("keeps the selected group isolated after result order changes", () => {
    const spec = timeSeriesChartSpec.parse({ showLegend: true });
    const rows = [
      { time: "2026-06-07T00:00:00", host: "a", value: 100 },
      { time: "2026-06-07T00:00:00", host: "b", value: 50 },
    ];
    const { rerender } = render(
      <TimeSeriesChartVisualization {...props} spec={spec} data={[rows]} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /^a$/ }));
    expect(screen.getByRole("button", { name: /^a$/ })).toHaveAttribute("aria-pressed", "true");

    rerender(<TimeSeriesChartVisualization {...props} spec={spec} data={[[...rows].reverse()]} />);
    expect(screen.getByRole("button", { name: /^a$/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /^b$/ })).toHaveAttribute("aria-pressed", "false");

    rerender(<TimeSeriesChartVisualization {...props} spec={spec} data={[[rows[1]!]]} />);
    expect(screen.getByRole("button", { name: /^b$/ })).toHaveAttribute("aria-pressed", "false");
  });
});
