import { describe, expect, it } from "vitest";
import { buildChartModel } from "./time-series-data";

const TS_KEY = "__ts";

describe("buildChartModel", () => {
  it("keeps a single query's value keys unprefixed", () => {
    const model = buildChartModel(
      [[{ time: "2026-06-07T00:00:00", value: 5 }]],
      undefined,
    );
    expect(model.valueKeys).toEqual(["value"]);
    expect(model.chartData[0]?.[TS_KEY]).toBeTypeOf("number");
    expect(model.chartData[0]?.value).toBe(5);
  });

  it("namespaces colliding value keys across two queries and merges by time", () => {
    const model = buildChartModel(
      [
        [{ time: "2026-06-07T00:00:00", value: 1 }],
        [{ time: "2026-06-07T00:00:00", value: 2 }],
      ],
      undefined,
    );
    expect(model.valueKeys).toEqual(["q0__value", "q1__value"]);
    expect(model.chartData).toHaveLength(1);
    expect(model.chartData[0]?.q0__value).toBe(1);
    expect(model.chartData[0]?.q1__value).toBe(2);
  });

  it("assigns distinct colors to series across queries", () => {
    const model = buildChartModel(
      [
        [{ time: "2026-06-07T00:00:00", value: 1 }],
        [{ time: "2026-06-07T00:00:00", value: 2 }],
      ],
      undefined,
    );
    expect(model.chartConfig.q0__value?.color).not.toBe(
      model.chartConfig.q1__value?.color,
    );
  });

  it("returns an empty model for empty input", () => {
    expect(buildChartModel([], undefined)).toEqual({
      chartData: [],
      valueKeys: [],
      chartConfig: {},
    });
  });

  it("pivots a grouped series into one key per group value", () => {
    const model = buildChartModel(
      [
        [
          { time: "2026-06-07T00:00:00", host: "a", value: 1 },
          { time: "2026-06-07T00:00:00", host: "b", value: 2 },
          { time: "2026-06-07T00:01:00", host: "a", value: 3 },
        ],
      ],
      undefined,
    );
    // Series keys are the sanitized group values, sorted.
    expect(model.valueKeys).toEqual(["a", "b"]);
    // Rows are merged by timestamp: host a+b at t0, host a at t1.
    expect(model.chartData).toHaveLength(2);
    expect(model.chartData[0]?.a).toBe(1);
    expect(model.chartData[0]?.b).toBe(2);
    expect(model.chartData[1]?.a).toBe(3);
  });

  it("fills gaps and clamps to the domain", () => {
    const minute = 60_000;
    // toTimestamp parses these as UTC; mirror that with the "Z" suffix here.
    const t0 = Date.parse("2026-06-07T00:00:00Z");
    const model = buildChartModel(
      [
        [
          { time: "2026-06-07T00:00:00", value: 1 },
          { time: "2026-06-07T00:01:00", value: 2 },
          { time: "2026-06-07T00:02:00", value: 3 },
        ],
      ],
      // Domain extends two intervals past the last point so the tail is filled.
      [t0, t0 + 4 * minute],
    );
    const TS = TS_KEY;
    // Detected interval is 1 minute; domain spans 0..4 min → 5 steps.
    expect(model.chartData).toHaveLength(5);
    // Every timestamp falls within the domain.
    for (const row of model.chartData) {
      const ts = row[TS] as number;
      expect(ts).toBeGreaterThanOrEqual(t0);
      expect(ts).toBeLessThanOrEqual(t0 + 4 * minute);
    }
    // The two trailing steps are gaps filled with null.
    const filled = model.chartData.filter((r) => r.value === null);
    expect(filled.length).toBeGreaterThanOrEqual(1);
    expect(model.chartData[3]?.value).toBeNull();
    expect(model.chartData[4]?.value).toBeNull();
  });
});
