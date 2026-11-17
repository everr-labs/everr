import { describe, expect, it } from "vite-plus/test";
import { panelPluginSpecs } from "#app/data/dashboards/plugin-specs.ts";
import { barChartSpec } from "./bar-chart/spec";
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
    expect(spec.yAxis).toBeUndefined();
  });

  it("accepts fixed and explicitly automatic time series bounds", () => {
    const { spec, warnings } = parseSpecLenient(timeSeriesChartSpec, {
      yAxis: { min: 0, max: "auto" },
    });
    expect(warnings).toEqual([]);
    expect(spec.yAxis).toEqual({ min: 0, max: "auto" });
    expect(timeSeriesChartSpec.parse({ yAxis: { min: "auto", max: 100 } }).yAxis).toEqual({
      min: "auto",
      max: 100,
    });
  });

  it("rejects inverted fixed time series bounds", () => {
    expect(timeSeriesChartSpec.safeParse({ yAxis: { min: 100, max: 0 } }).success).toBe(false);
    const { spec, warnings } = parseSpecLenient(timeSeriesChartSpec, {
      yAxis: { min: 100, max: 0 },
      showLegend: true,
    });
    expect(spec.yAxis).toBeUndefined();
    expect(spec.showLegend).toBe(true);
    expect(warnings[0]).toMatch(/^yAxis\.max: /);
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
    expect(schema?.safeParse({ valueFormat: { scale: "invalid" } }).success).toBe(false);
    expect(schema?.safeParse({ valueFormat: { scale: "duration", unit: "widgets" } }).success).toBe(
      false,
    );
    expect(schema?.parse({ valueFormat: {} })).toMatchObject({
      valueFormat: { unit: "", scale: "none" },
    });
  });
  it.each(["StatChart", "GaugeChart"])("%s accepts only opaque hex threshold colors", (kind) => {
    const schema = panelPluginSpecs[kind];
    for (const color of ["#fff", "#22C55E"]) {
      expect(schema?.safeParse({ thresholds: { defaultColor: color } }).success).toBe(true);
      expect(schema?.safeParse({ thresholds: { steps: [{ value: 1, color }] } }).success).toBe(
        true,
      );
    }
    for (const color of ["#ffff", "#22c55e80", "green", "rgb(0, 0, 0)", "transparent"]) {
      expect(schema?.safeParse({ thresholds: { defaultColor: color } }).success).toBe(false);
      expect(schema?.safeParse({ thresholds: { steps: [{ value: 1, color }] } }).success).toBe(
        false,
      );
    }
  });

  it("drops thresholds with a non-hex color at render and warns", () => {
    const { spec, warnings } = parseSpecLenient(statChartSpec, {
      thresholds: { defaultColor: "green", steps: [{ value: 1, color: "#ff0000" }] },
    });
    expect(spec.thresholds).toBeUndefined();
    expect(warnings).toEqual(["thresholds.defaultColor: must be an opaque hex color like #22c55e"]);
  });

  it.each(["StatChart", "BarChart", "StateTimeline", "StatusHistory"])(
    "%s accepts only opaque hex colors",
    (kind) => {
      const schema = panelPluginSpecs[kind];
      expect(schema?.safeParse({ colors: { ok: "#fff", error: "#FF6467" } }).success).toBe(true);
      for (const color of ["#22c55e80", "green", "hsl(0, 90%, 65%)", "var(--chart-1)"]) {
        expect(schema?.safeParse({ colors: { ok: color } }).success).toBe(false);
      }
    },
  );

  it("drops a colors map with a non-hex color at render and warns", () => {
    const { spec, warnings } = parseSpecLenient(barChartSpec, {
      colors: { good: "#05df72", poor: "red" },
    });
    expect(spec.colors).toEqual({});
    expect(warnings).toEqual(["colors.poor: must be an opaque hex color like #22c55e"]);
  });

  it("every registered spec schema parses {} (lenient fallback never throws)", () => {
    for (const [kind, schema] of Object.entries(panelPluginSpecs)) {
      expect(schema.safeParse({}).success, `${kind} must parse {}`).toBe(true);
    }
  });
});
