import { describe, expect, it } from "vitest";
import {
  computeStepSeconds,
  DEFAULT_TARGET_POINTS,
  snapToNiceStep,
} from "./bucket";

describe("snapToNiceStep", () => {
  it("rounds up to the nearest nice clock step", () => {
    expect(snapToNiceStep(7.2)).toBe(10); // 1h / 500
    expect(snapToNiceStep(60)).toBe(60);
    expect(snapToNiceStep(61)).toBe(120);
    expect(snapToNiceStep(1209.6)).toBe(1800); // 7d / 500 -> 30m
  });

  it("never returns less than 1 second", () => {
    expect(snapToNiceStep(0)).toBe(1);
    expect(snapToNiceStep(0.1)).toBe(1);
    expect(snapToNiceStep(-5)).toBe(1);
  });

  it("rounds up to whole days beyond the ladder", () => {
    expect(snapToNiceStep(86401)).toBe(2 * 86400);
    expect(snapToNiceStep(200000)).toBe(3 * 86400);
  });
});

describe("computeStepSeconds", () => {
  it("targets ~500 buckets and scales with the range", () => {
    const oneHour = computeStepSeconds(
      "2026-06-10 09:00:00.000",
      "2026-06-10 10:00:00.000",
    );
    const sevenDays = computeStepSeconds(
      "2026-06-03 09:00:00.000",
      "2026-06-10 09:00:00.000",
    );
    // Wider range -> larger bucket; both keep the point count bounded.
    expect(oneHour).toBeLessThan(sevenDays);
    expect(3600 / oneHour).toBeLessThanOrEqual(DEFAULT_TARGET_POINTS);
    expect(604800 / sevenDays).toBeLessThanOrEqual(DEFAULT_TARGET_POINTS);
  });

  it("parses the UTC datetime strings (offset cancels in the diff)", () => {
    // 1h apart -> 3600s / 500 = 7.2 -> snapped to 10s.
    expect(
      computeStepSeconds("2026-06-10 09:00:00.000", "2026-06-10 10:00:00.000"),
    ).toBe(10);
  });

  it("honours a custom target point count", () => {
    // 1h with a tiny budget -> coarser buckets: 3600 / 10 = 360 -> snapped to 600.
    expect(
      computeStepSeconds(
        "2026-06-10 09:00:00.000",
        "2026-06-10 10:00:00.000",
        10,
      ),
    ).toBe(600);
  });

  it("floors at 1 second for a zero/negative range", () => {
    expect(
      computeStepSeconds("2026-06-10 09:00:00.000", "2026-06-10 09:00:00.000"),
    ).toBe(1);
  });
});
