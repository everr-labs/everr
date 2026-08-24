import { describe, expect, it } from "vitest";
import {
  BYTES_PER_GB,
  calculateUsageOverage,
  PRO_OVERAGE_USD_PER_GB,
  resolveUsageLimits,
  USAGE_METERS,
} from "./usage-limits";

describe("usage limits", () => {
  it("uses decimal gigabytes for every signal allowance", () => {
    expect(BYTES_PER_GB).toBe(1_000_000_000);

    const free = resolveUsageLimits("free");
    const pro = resolveUsageLimits("pro");

    for (const meter of USAGE_METERS) {
      expect(free[meter]).toEqual({
        includedGb: 5,
        includedBytes: 5_000_000_000,
        overageUsdPerGb: null,
      });
      expect(pro[meter]).toEqual({
        includedGb: 100,
        includedBytes: 100_000_000_000,
        overageUsdPerGb: PRO_OVERAGE_USD_PER_GB,
      });
    }
  });

  it("does not charge usage at or below the included allowance", () => {
    const limit = resolveUsageLimits("pro").logs;

    expect(calculateUsageOverage(limit.includedBytes, limit)).toEqual({
      overageBytes: 0,
      overageGb: 0,
      costUsd: 0,
    });
  });

  it("calculates Pro overage per decimal gigabyte", () => {
    const limit = resolveUsageLimits("pro").traces;

    expect(
      calculateUsageOverage(limit.includedBytes + 2_500_000_000, limit),
    ).toEqual({
      overageBytes: 2_500_000_000,
      overageGb: 2.5,
      costUsd: 1,
    });
  });

  it("reports free-tier excess without assigning an overage price", () => {
    const limit = resolveUsageLimits("free").metrics;

    expect(
      calculateUsageOverage(limit.includedBytes + BYTES_PER_GB, limit),
    ).toEqual({
      overageBytes: BYTES_PER_GB,
      overageGb: 1,
      costUsd: null,
    });
  });

  it("rejects invalid usage values", () => {
    const limit = resolveUsageLimits("pro").metrics;

    expect(() => calculateUsageOverage(-1, limit)).toThrow(RangeError);
    expect(() => calculateUsageOverage(Number.NaN, limit)).toThrow(RangeError);
  });
});
