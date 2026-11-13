import { describe, expect, it } from "vite-plus/test";
import type { PanelPlugin } from "#app/data/dashboards/schema.ts";
import { getVisualizationDownsample } from "./index";

describe("getVisualizationDownsample", () => {
  const cases: Array<{ name: string; plugin: PanelPlugin; expected: "m4" | undefined }> = [
    { name: "a line chart", plugin: { kind: "TimeSeriesChart", spec: {} }, expected: "m4" },
    {
      name: "a stacked line chart",
      plugin: { kind: "TimeSeriesChart", spec: { stacked: true } },
      expected: undefined,
    },
    {
      name: "a line chart whose invalid stacked option falls back to its default",
      plugin: { kind: "TimeSeriesChart", spec: { stacked: "yes" } },
      expected: "m4",
    },
    { name: "a table", plugin: { kind: "Table", spec: {} }, expected: undefined },
    { name: "a bar chart", plugin: { kind: "BarChart", spec: {} }, expected: undefined },
    { name: "an unknown kind", plugin: { kind: "Nope", spec: {} }, expected: undefined },
  ];

  it.each(cases)("$name", ({ plugin, expected }) => {
    expect(getVisualizationDownsample(plugin)).toBe(expected);
  });
});
