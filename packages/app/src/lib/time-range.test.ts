import { describe, expect, it } from "vitest";
import {
  DEFAULT_TIME_RANGE,
  formatTimeRangeDisplay,
  getRefreshIntervalMs,
  ResolvedTimeRangeSearchSchema,
  resolveTimeRange,
  TimeRangeSchema,
  withTimeRange,
} from "./time-range";

describe("TimeRangeSchema", () => {
  it("accepts valid datemath expressions", () => {
    const result = TimeRangeSchema.parse({ from: "now-1h", to: "now" });
    expect(result).toEqual({ from: "now-1h", to: "now" });
  });

  it("falls back to default for invalid from", () => {
    const result = TimeRangeSchema.parse({ from: "garbage", to: "now" });
    expect(result.from).toBe(DEFAULT_TIME_RANGE.from);
  });

  it("falls back to default for invalid to", () => {
    const result = TimeRangeSchema.parse({ from: "now-1h", to: "garbage" });
    expect(result.to).toBe(DEFAULT_TIME_RANGE.to);
  });

  it("falls back to defaults for both invalid", () => {
    const result = TimeRangeSchema.parse({ from: "bad", to: "bad" });
    expect(result).toEqual(DEFAULT_TIME_RANGE);
  });
});

describe("ResolvedTimeRangeSearchSchema", () => {
  it("applies defaults when fields are missing", () => {
    const result = ResolvedTimeRangeSearchSchema.parse({});
    expect(result).toEqual({
      from: DEFAULT_TIME_RANGE.from,
      to: DEFAULT_TIME_RANGE.to,
      refresh: "",
    });
  });

  it("preserves valid values", () => {
    const result = ResolvedTimeRangeSearchSchema.parse({
      from: "now-1h",
      to: "now",
      refresh: "5s",
    });
    expect(result).toEqual({ from: "now-1h", to: "now", refresh: "5s" });
  });

  it("falls back to default for invalid datemath", () => {
    const result = ResolvedTimeRangeSearchSchema.parse({
      from: "not-datemath",
      to: "also-bad",
    });
    expect(result.from).toBe(DEFAULT_TIME_RANGE.from);
    expect(result.to).toBe(DEFAULT_TIME_RANGE.to);
  });

  it("does not include refresh in the output of from/to only access", () => {
    const { from, to } = ResolvedTimeRangeSearchSchema.parse({
      refresh: "10s",
    });
    expect(from).toBe(DEFAULT_TIME_RANGE.from);
    expect(to).toBe(DEFAULT_TIME_RANGE.to);
  });
});

describe("resolveTimeRange", () => {
  it("resolves datemath to Date objects and ISO strings", () => {
    const result = resolveTimeRange({ from: "now-1h", to: "now" });
    expect(result.fromDate).toBeInstanceOf(Date);
    expect(result.toDate).toBeInstanceOf(Date);
    expect(result.fromDate < result.toDate).toBe(true);
    expect(result.fromISO).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/);
    expect(result.toISO).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/);
  });
});

describe("getRefreshIntervalMs", () => {
  it("returns ms for known intervals", () => {
    expect(getRefreshIntervalMs("5s")).toBe(5_000);
    expect(getRefreshIntervalMs("10s")).toBe(10_000);
    expect(getRefreshIntervalMs("30s")).toBe(30_000);
    expect(getRefreshIntervalMs("1m")).toBe(60_000);
    expect(getRefreshIntervalMs("5m")).toBe(300_000);
  });

  it("returns null for off", () => {
    expect(getRefreshIntervalMs("")).toBeNull();
  });

  it("returns null for unknown values", () => {
    expect(getRefreshIntervalMs("99x")).toBeNull();
  });
});

describe("withTimeRange", () => {
  it("fills in defaults when from/to are missing", () => {
    const result = withTimeRange({});
    expect(result.from).toBe(DEFAULT_TIME_RANGE.from);
    expect(result.to).toBe(DEFAULT_TIME_RANGE.to);
    expect(result.timeRange).toEqual(DEFAULT_TIME_RANGE);
  });

  it("preserves provided values and extra properties", () => {
    const result = withTimeRange({ from: "now-1d", to: "now", extra: true });
    expect(result.from).toBe("now-1d");
    expect(result.to).toBe("now");
    expect(result.timeRange).toEqual({ from: "now-1d", to: "now" });
    expect(result.extra).toBe(true);
  });
});

describe("formatTimeRangeDisplay", () => {
  it("returns preset label for known ranges", () => {
    expect(formatTimeRangeDisplay({ from: "now-7d", to: "now" })).toBe(
      "Last 7 days",
    );
    expect(formatTimeRangeDisplay({ from: "now-1h", to: "now" })).toBe(
      "Last 1 hour",
    );
  });

  it("returns raw expression for custom ranges", () => {
    expect(formatTimeRangeDisplay({ from: "now-3h", to: "now" })).toBe(
      "now-3h to now",
    );
  });
});
