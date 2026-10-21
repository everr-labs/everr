import { describe, expect, it } from "vite-plus/test";
import { bucketSeconds, snapToNiceStep } from "./bucket";

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

describe("bucketSeconds", () => {
  const at = (iso: string) => new Date(iso);

  it("targets the bucket count and scales with the range", () => {
    const oneHour = bucketSeconds(at("2026-06-10T09:00:00Z"), at("2026-06-10T10:00:00Z"), 500);
    const sevenDays = bucketSeconds(at("2026-06-03T09:00:00Z"), at("2026-06-10T09:00:00Z"), 500);
    // Wider range -> larger bucket; both keep the point count bounded.
    expect(oneHour).toBeLessThan(sevenDays);
    expect(3600 / oneHour).toBeLessThanOrEqual(500);
    expect(604800 / sevenDays).toBeLessThanOrEqual(500);
  });

  it("snaps the ideal width up to a nice step", () => {
    // 1h / 500 = 7.2s -> snapped to 10s.
    expect(bucketSeconds(at("2026-06-10T09:00:00Z"), at("2026-06-10T10:00:00Z"), 500)).toBe(10);
  });

  it("honours the target bucket count", () => {
    // 1h with a tiny budget -> coarser buckets: 3600 / 10 = 360 -> snapped to 600.
    expect(bucketSeconds(at("2026-06-10T09:00:00Z"), at("2026-06-10T10:00:00Z"), 10)).toBe(600);
  });

  it("picks the smallest interval >= ideal (histogram case)", () => {
    // 1h / 60 = 60s exactly.
    expect(bucketSeconds(at("2026-03-09T00:00:00Z"), at("2026-03-09T01:00:00Z"), 60)).toBe(60);
  });

  it("extends past one day for a long range instead of capping", () => {
    // ~364d / 80 ≈ 393k s -> ceil to 5 whole days (the histogram used to cap
    // at 1 day here, maxing out at ~364 buckets).
    expect(bucketSeconds(at("2026-01-01T00:00:00Z"), at("2026-12-31T00:00:00Z"), 80)).toBe(
      5 * 86400,
    );
  });

  it("floors at 1 second for a zero/negative range", () => {
    expect(bucketSeconds(at("2026-06-10T09:00:00Z"), at("2026-06-10T09:00:00Z"), 500)).toBe(1);
  });
});
