import { describe, expect, it } from "vite-plus/test";
import { formatPercent, formatProfileValue } from "./format";

describe("formatProfileValue", () => {
  it.each([
    [850, "nanoseconds", "850 ns"],
    [1_500_000, "nanoseconds", "1.5 ms"],
    [2_340_000_000, "nanoseconds", "2.34 s"],
    [90, "seconds", "1.5 min"],
    [512, "bytes", "512 B"],
    [1536, "bytes", "1.5 KiB"],
    [5 * 1024 * 1024, "bytes", "5 MiB"],
    [1, "count", "1 sample"],
    [12345, "count", "12,345 samples"],
    [3, "widgets", "3 widgets"],
  ])("formats %d %s as %s", (value, unit, expected) => {
    expect(formatProfileValue(value, unit)).toBe(expected);
  });
});

describe("formatPercent", () => {
  it("rounds to two decimals and marks tiny shares", () => {
    expect(formatPercent(1, 3)).toBe("33.33%");
    expect(formatPercent(5, 5)).toBe("100%");
    expect(formatPercent(1, 1_000_000)).toBe("<0.01%");
    expect(formatPercent(1, 0)).toBe("0%");
  });
});
