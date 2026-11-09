import { BarChart } from "echarts/charts";
import { GridComponent } from "echarts/components";
import * as echarts from "echarts/core";
import { SVGRenderer } from "echarts/renderers";
import { describe, expect, it } from "vite-plus/test";
import { niceLinearDomain } from "../data-utils";
import { createValueFormatter } from "../value-format";
import { niceValueAxis, valueAxisOption } from "./axis";

echarts.use([BarChart, GridComponent, SVGRenderer]);

const bytes = createValueFormatter({ unit: "By", scale: "binary" });

describe("niceValueAxis", () => {
  it("labels round steps in the displayed unit", () => {
    const { scale, format } = niceValueAxis(bytes, 0, 5.2 * 1024 ** 3);
    expect(scale.ticks.map(format)).toEqual(["0 GiB", "2 GiB", "4 GiB", "6 GiB"]);
  });

  it("keeps one unit when the rounded edge crosses into the next", () => {
    const { scale, format } = niceValueAxis(bytes, 0, 1000 * 1024);
    expect(scale.domain[1]).toBeGreaterThanOrEqual(1024 * 1024);
    expect(scale.ticks.map(format).every((label) => label.endsWith(" KiB"))).toBe(true);
  });
});

describe("valueAxisOption", () => {
  const theme = {
    textColor: "#000",
    foregroundColor: "#000",
    gridColor: "#ccc",
    fontFamily: "sans-serif",
  };

  it.each([
    ["a fixed min and max off the step", 930, 970, { min: 925, max: 975 }],
    ["a fixed negative min off the step", -130_000, 400_000, { min: -130_000 }],
  ])("draws exactly the computed ticks with %s", (_, lo, hi, bounds) => {
    const scale = niceLinearDomain(lo, hi, 5, bounds);
    const chart = echarts.init(null, undefined, {
      renderer: "svg",
      ssr: true,
      width: 600,
      height: 300,
    });
    chart.setOption({
      xAxis: { type: "category", data: ["a"] },
      yAxis: valueAxisOption({ theme, scale, format: String }),
      series: [{ type: "bar", data: [hi] }],
    });
    // ECharts exposes drawn tick positions through its internal axis model only.
    const axis = chart.getModel().getComponent("yAxis").axis;
    const drawn = axis.getTicksCoords().map((tick: { tickValue: number }) => tick.tickValue);
    expect(drawn).toEqual(scale.ticks);
  });
});
