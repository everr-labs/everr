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
});
