import { describe, expect, it } from "vite-plus/test";
import { defaultAggregation, summaryAggregations } from "./types";

describe("summaryAggregations", () => {
  it("offers the reported quantiles, then avg and rate", () => {
    expect(summaryAggregations([0.5, 0.9, 0.99])).toEqual(["p50", "p90", "p99", "avg", "rate"]);
  });

  it("reads quantiles 0 and 1 as min and max", () => {
    expect(summaryAggregations([0, 1])).toEqual(["min", "max", "avg", "rate"]);
  });

  it("still offers avg and rate without quantiles", () => {
    expect(summaryAggregations([])).toEqual(["avg", "rate"]);
  });
});

describe("defaultAggregation for a summary", () => {
  it("picks a high percentile it reports", () => {
    expect(defaultAggregation("summary", summaryAggregations([0.5, 0.99]))).toBe("p99");
  });
});
