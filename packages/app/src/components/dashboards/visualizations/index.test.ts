import { describe, expect, it } from "vite-plus/test";
import type { PanelPlugin } from "#app/data/dashboards/schema.ts";
import { visualizationDownsamples } from "./index";

describe("visualizationDownsamples", () => {
  const cases: Array<{ name: string; plugin: PanelPlugin; expected: boolean }> = [
    { name: "a line chart", plugin: { kind: "TimeSeriesChart", spec: {} }, expected: true },
    {
      name: "a stacked line chart",
      plugin: { kind: "TimeSeriesChart", spec: { stacked: true } },
      expected: false,
    },
    {
      name: "a line chart whose invalid stacked option falls back to its default",
      plugin: { kind: "TimeSeriesChart", spec: { stacked: "yes" } },
      expected: true,
    },
    { name: "a table", plugin: { kind: "Table", spec: {} }, expected: false },
    { name: "a bar chart", plugin: { kind: "BarChart", spec: {} }, expected: false },
    { name: "an unknown kind", plugin: { kind: "Nope", spec: {} }, expected: false },
  ];

  it.each(cases)("$name", ({ plugin, expected }) => {
    expect(visualizationDownsamples(plugin)).toBe(expected);
  });
});
