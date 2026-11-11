import { BarChart } from "echarts/charts";
import { GridComponent } from "echarts/components";
import * as echarts from "echarts/core";
import { SVGRenderer } from "echarts/renderers";
import { describe, expect, it } from "vite-plus/test";
import { generateTimeTicks, niceLinearDomain, timeTickInterval } from "../data-utils";
import { createValueFormatter } from "../value-format";
import { niceValueAxis, timeLabelFormatter, valueAxisOption } from "./axis";

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
  const start = new Date(2026, 10, 4).getTime();
  const month = new Intl.DateTimeFormat(undefined, { month: "short" }).format(start);
  const labels = (hours: number) => {
    const domain: [number, number] = [start + 2 * 3_600_000, start + (2 + hours) * 3_600_000];
    return generateTimeTicks(domain, 6).map(
      timeLabelFormatter(domain, timeTickInterval(domain, 6)),
    );
  };

  it.each([
    ["half a day, as times alone", 12, false],
    ["two days, each with its date", 48, true],
  ])("labels every tick over %s", (_, hours, dated) => {
    const ticks = labels(hours);
    expect(ticks.length).toBeGreaterThanOrEqual(3);
    expect(ticks.map((label) => label.includes(month))).toEqual(ticks.map(() => dated));
    expect(new Set(ticks).size).toBe(ticks.length);
  });

  it("labels a whole day, midnight to midnight, with times alone", () => {
    const day: [number, number] = [start, start + 24 * 3_600_000];
    expect(timeLabelFormatter(day, 6 * 3_600_000)(start)).not.toContain(month);
  });

  it.each([
    ["a week of day ticks", 7 * 24],
    ["three years of year ticks", 3 * 365 * 24],
  ])("names each tick over %s once", (_, hours) => {
    const ticks = labels(hours);
    expect(ticks.length).toBeGreaterThanOrEqual(2);
    expect(new Set(ticks).size).toBe(ticks.length);
  });
});
