import { BarChart } from "echarts/charts";
import { GridComponent } from "echarts/components";
import * as echarts from "echarts/core";
import { SVGRenderer } from "echarts/renderers";
import { describe, expect, it } from "vite-plus/test";
import { niceLinearDomain } from "../data-utils";
import { createValueFormatter } from "../value-format";
import { niceValueAxis, timeLabelFormatter, timeTicks, valueAxisOption } from "./axis";

echarts.use([BarChart, GridComponent, SVGRenderer]);

const bytes = createValueFormatter({ unit: "By", scale: "binary" });

describe("niceValueAxis", () => {
  it.each([
    [bytes, 5.2 * 1024 ** 3, ["0 GiB", "2 GiB", "4 GiB", "6 GiB"]],
    [
      createValueFormatter({ unit: "s", scale: "duration" }),
      500,
      ["0 min", "2.5 min", "5 min", "7.5 min", "10 min"],
    ],
  ])("labels round steps in the displayed unit", (formatter, max, labels) => {
    const { scale, format } = niceValueAxis(formatter, 0, max);
    expect(scale.ticks.map(format)).toEqual(labels);
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
    cardColor: "#fff",
    fontFamily: "sans-serif",
  };

  it("draws exactly the computed ticks when a fixed min is off the step", () => {
    const scale = niceLinearDomain(930, 970, 5, { min: 925, max: 975 });
    const chart = echarts.init(null, undefined, {
      renderer: "svg",
      ssr: true,
      width: 600,
      height: 300,
    });
    chart.setOption({
      xAxis: { type: "category", data: ["a"] },
      yAxis: valueAxisOption({ theme, scale, format: (value) => `tick:${value}` }),
      series: [{ type: "bar", data: [950] }],
    });
    const drawn = [...chart.renderToSVGString().matchAll(/>tick:(-?[\d.]+)</g)].map(([, value]) =>
      Number(value),
    );
    expect(drawn.sort((a, b) => a - b)).toEqual(scale.ticks);
  });
});

describe("timeLabelFormatter", () => {
  it.each([
    ["two days of half-day ticks", 2],
    ["a week of day ticks", 7],
  ])("names each day ticked once over %s, and no two neighboring ticks alike", (_, days) => {
    const start = new Date(2026, 10, 4).getTime();
    const domain: [number, number] = [start, start + days * 86_400_000];
    const format = timeLabelFormatter(domain);
    const ticks = timeTicks(domain);
    const labels = ticks.map(format);
    expect(labels.filter((label, i) => label === labels[i - 1])).toEqual([]);
    const dates = ticks.filter((tick) => new Date(tick).getHours() === 0).map(format);
    expect(dates.length).toBeGreaterThanOrEqual(2);
    expect(new Set(dates).size).toBe(dates.length);
  });
});
