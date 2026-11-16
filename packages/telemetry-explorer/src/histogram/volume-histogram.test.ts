import { describe, expect, it } from "vite-plus/test";
import { axisLabels } from "./volume-histogram";

function buckets(start: Date, count: number, hours: number) {
  return Array.from({ length: count }, (_, i) => {
    const from = new Date(start.getTime() + i * hours * 3_600_000);
    const to = new Date(from.getTime() + hours * 3_600_000);
    return { timestamp: from.toISOString(), endTimestamp: to.toISOString() };
  });
}

const day = (d: number) =>
  new Date(2026, 10, d).toLocaleDateString([], { month: "short", day: "numeric" });

describe("axisLabels", () => {
  it("names each day on a multi-day range, and leaves the rest of the buckets blank", () => {
    // Three days of 3-hour buckets, from local midnight.
    const labels = axisLabels(buckets(new Date(2026, 10, 10), 24, 3));
    // Midnight names the day; noon, in between, is a time.
    expect([labels[0], labels[8], labels[16]]).toEqual([day(10), day(11), day(12)]);
    expect(labels[4]).toMatch(/12/);
    expect(labels[1]).toBe("");
  });

  it("labels times within a day", () => {
    const labels = axisLabels(buckets(new Date(2026, 10, 10, 6), 12, 1));
    expect(labels.filter(Boolean).length).toBeGreaterThan(1);
    expect(labels.filter(Boolean).every((label) => /\d/.test(label) && label !== day(10))).toBe(
      true,
    );
  });
});
