import { describe, expect, it } from "vitest";
import { panelPluginSpecs } from "@/data/dashboards/plugin-specs";
import { parseSpecLenient } from "./parse-spec";
import { statChartSpec } from "./stat-chart/spec";
import { timeSeriesChartSpec } from "./time-series-chart/spec";

describe("parseSpecLenient", () => {
  it("returns the parsed spec with no warnings for valid input", () => {
    const { spec, warnings } = parseSpecLenient(timeSeriesChartSpec, {
      valueFormat: { unit: "s", scale: "duration" },
      lineWidth: 2,
    });
    expect(warnings).toEqual([]);
    expect(spec.valueFormat).toEqual({ unit: "s", scale: "duration" });
    expect(spec.lineWidth).toBe(2);
    expect(spec.curveType).toBe("monotone");
  });

  it("drops an invalid option to its default and warns with the path", () => {
    const { spec, warnings } = parseSpecLenient(timeSeriesChartSpec, {
      lineWidth: "3",
      valueFormat: { unit: "ms" },
    });
    expect(spec.lineWidth).toBe(1.5);
    expect(spec.valueFormat?.unit).toBe("ms");
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/^lineWidth: /);
  });

  it("warns about incompatible duration input units", () => {
    const { spec, warnings } = parseSpecLenient(timeSeriesChartSpec, {
      valueFormat: { unit: "widgets", scale: "duration" },
    });
    expect(spec.valueFormat).toBeUndefined();
    expect(warnings[0]).toMatch(/^valueFormat\.unit: /);
  });

  it("warns once per invalid option and keeps the valid ones", () => {
    const { spec, warnings } = parseSpecLenient(timeSeriesChartSpec, {
      lineWidth: -1,
      curveType: "wiggly",
      showLegend: true,
    });
    expect(spec.lineWidth).toBe(1.5);
    expect(spec.curveType).toBe("monotone");
    expect(spec.showLegend).toBe(true);
    expect(warnings).toHaveLength(2);
  });

  it("drops a structurally invalid nested option entirely", () => {
    const { spec, warnings } = parseSpecLenient(statChartSpec, {
      thresholds: { steps: [{ value: "high" }] },
      valueFormat: { unit: "%" },
    });
    expect(spec.thresholds).toBeUndefined();
    expect(spec.valueFormat?.unit).toBe("%");
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/^thresholds\.steps\.0\.value: /);
  });

  it("falls back to all defaults for a non-object spec", () => {
    const { spec, warnings } = parseSpecLenient(timeSeriesChartSpec, "nope");
    expect(spec.lineWidth).toBe(1.5);
    expect(warnings.length).toBeGreaterThan(0);
  });

  it("preserves unknown keys (never stricter than Perses)", () => {
    const { spec, warnings } = parseSpecLenient(timeSeriesChartSpec, {
      somethingNew: true,
    });
    expect(warnings).toEqual([]);
    expect((spec as Record<string, unknown>).somethingNew).toBe(true);
  });
});

describe("panel plugin spec contracts", () => {
  it.each([
    "TimeSeriesChart",
    "BarChart",
    "StatChart",
    "GaugeChart",
    "Table",
    "GeoMap",
    "Treemap",
    "Heatmap",
    "NodeGraph",
  ])("%s validates and defaults the shared format", (kind) => {
    const schema = panelPluginSpecs[kind];
    expect(
      schema?.safeParse({ valueFormat: { scale: "invalid" } }).success,
    ).toBe(false);
    expect(
      schema?.safeParse({ valueFormat: { scale: "duration", unit: "widgets" } })
        .success,
    ).toBe(false);
    expect(schema?.parse({ valueFormat: {} })).toMatchObject({
      valueFormat: { unit: "", scale: "none" },
    });
  });
  it("every registered spec schema parses {} (lenient fallback never throws)", () => {
    for (const [kind, schema] of Object.entries(panelPluginSpecs)) {
      expect(schema.safeParse({}).success, `${kind} must parse {}`).toBe(true);
    }
  });
});
