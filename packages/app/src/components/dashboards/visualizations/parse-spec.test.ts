import { describe, expect, it } from "vitest";
import { panelPluginSpecs } from "@/data/dashboards/plugin-specs";
import { parseSpecLenient } from "./parse-spec";
import { statChartSpec } from "./stat-chart/spec";
import { timeSeriesChartSpec } from "./time-series-chart/spec";

describe("parseSpecLenient", () => {
  it("returns the parsed spec with no warnings for valid input", () => {
    const { spec, warnings } = parseSpecLenient(timeSeriesChartSpec, {
      unit: "ms",
      lineWidth: 2,
    });
    expect(warnings).toEqual([]);
    expect(spec.unit).toBe("ms");
    expect(spec.lineWidth).toBe(2);
    expect(spec.curveType).toBe("monotone");
  });

  it("drops an invalid option to its default and warns with the path", () => {
    const { spec, warnings } = parseSpecLenient(timeSeriesChartSpec, {
      lineWidth: "3",
      unit: "ms",
    });
    expect(spec.lineWidth).toBe(1.5);
    expect(spec.unit).toBe("ms");
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/^lineWidth: /);
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
      unit: "%",
    });
    expect(spec.thresholds).toBeUndefined();
    expect(spec.unit).toBe("%");
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
  it("every registered spec schema parses {} (lenient fallback never throws)", () => {
    for (const [kind, schema] of Object.entries(panelPluginSpecs)) {
      expect(schema.safeParse({}).success, `${kind} must parse {}`).toBe(true);
    }
  });
});
