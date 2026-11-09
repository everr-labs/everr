import { fireEvent, render } from "@testing-library/react";
import * as echarts from "echarts/core";
import { beforeEach, describe, expect, it, onTestFinished, vi } from "vite-plus/test";
import { timeLabelFormatter } from "../echarts/axis";
import { BarChartVisualization } from "./bar-chart-visualization";
import { barChartSpec } from "./spec";

vi.mock("echarts/core", async (importOriginal) =>
  (await import("@everr/ui/testing/echarts")).ssrEChartsCore(importOriginal),
);

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
  });

  it("zooms to the whole buckets a drag runs across", () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
      DOMRect.fromRect({ x: 0, y: 0, width: 400, height: 200 }),
    );
    // jsdom has no pointer capture.
    HTMLElement.prototype.setPointerCapture = vi.fn();
    onTestFinished(() => {
      Reflect.deleteProperty(HTMLElement.prototype, "setPointerCapture");
    });
    const onTimeRangeChange = vi.fn();
    const hour = (h: number) => Date.UTC(2026, 5, 7, h);
    const { container } = render(
      <BarChartVisualization
        {...props}
        onTimeRangeChange={onTimeRangeChange}
        spec={barChartSpec.parse({})}
        data={[[0, 1, 2, 3].map((h) => ({ ts: new Date(hour(h)).toISOString(), count: h + 1 }))]}
      />,
    );
    const area = container.firstElementChild!;

    // The last quarter of the plot is the last bucket, so a drag from the
    // second one to the panel's edge covers buckets 1 to 3.
    fireEvent.pointerDown(area, { button: 0, clientX: 200, clientY: 100 });
    fireEvent.mouseMove(area, { clientX: 399, clientY: 100 });
    fireEvent.pointerUp(area);

    expect(onTimeRangeChange).toHaveBeenCalledWith({
      from: new Date(hour(1)),
      to: new Date(hour(4)),
    });
  });

  it("labels round times only on bars whose bucket holds them", () => {
    const hour = (h: number) => new Date(2026, 5, 7, h).getTime();
    const domain: [number, number] = [hour(0), hour(24)];
    // Hourly buckets, with 05:00 to 07:00 empty and so skipped by the query.
    const hours = Array.from({ length: 24 }, (_, h) => h).filter((h) => h < 5 || h > 7);
    render(
      <BarChartVisualization
        {...props}
        timeRange={{ from: new Date(domain[0]), to: new Date(domain[1]) }}
        spec={barChartSpec.parse({})}
        data={[hours.map((h) => ({ ts: new Date(hour(h)).toISOString(), count: 1 }))]}
      />,
    );

    const { formatter } = renderedChart().getOption().xAxis[0].axisLabel;
    const labelled = hours.flatMap((h, index) => {
      const label = formatter("", index);
      return label ? [[h, label]] : [];
    });
    // 06:00 falls in a skipped bucket: no bar takes its label.
    const format = timeLabelFormatter(domain);
    expect(labelled).toEqual([0, 12, 18].map((h) => [h, format(hour(h))]));
  });
});
