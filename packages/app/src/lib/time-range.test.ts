import { ErrorIssueSearchSchema } from "@everr/telemetry-explorer/errors";
import { TraceSearchParamsSchema } from "@everr/telemetry-explorer/traces";
import { getRefreshIntervalMs } from "@everr/ui/components/refresh-picker";
import { formatTimeRangeDisplay } from "@everr/ui/components/time-range-picker";
import {
  DEFAULT_TIME_RANGE,
  isValidTimeRange,
  resolveTimeRange,
  TimeRangeSchema,
  timeRangeFromDuration,
  withTimeRange,
} from "@everr/ui/lib/time-range";
import { describe, expect, it } from "vite-plus/test";
import { ResolvedTimeRangeSearchSchema, TimeRangeSearchSchema } from "./time-range";

it("preserves each explorer's handling of invalid time-range URLs", () => {
  const search = { from: "invalid-time" };
  expect(TimeRangeSearchSchema.parse(search).from).toBe("invalid-time");
  expect(TraceSearchParamsSchema.safeParse(search).success).toBe(false);
  expect(ErrorIssueSearchSchema.parse(search).from).toBeUndefined();
});

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
      refresh: "off",
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

  it("uses one reference time for both bounds", () => {
    const now = new Date("2026-09-12T12:00:00.000Z");
    const result = resolveTimeRange({ from: "now-1h", to: "now" }, now);
    expect(result.fromDate.toISOString()).toBe("2026-09-12T11:00:00.000Z");
    expect(result.toDate.toISOString()).toBe("2026-09-12T12:00:00.000Z");
  });
});

describe("isValidTimeRange", () => {
  const now = new Date("2026-09-12T12:00:00.000Z");

  it("accepts a chronological range", () => {
    expect(isValidTimeRange({ from: "now-6h", to: "now" }, now)).toBe(true);
  });

  it("rejects invalid and reversed ranges", () => {
    expect(isValidTimeRange({ from: "banana", to: "now" }, now)).toBe(false);
    expect(isValidTimeRange({ from: "now", to: "now-6h" }, now)).toBe(false);
  });
});

describe("timeRangeFromDuration", () => {
  const now = new Date("2026-09-12T12:00:00.000Z");

  it("converts a positive duration to a valid range", () => {
    expect(timeRangeFromDuration("6h", now)).toEqual({
      from: "now-6h",
      to: "now",
    });
  });

  it("rejects invalid and zero-length durations", () => {
    expect(timeRangeFromDuration("banana", now)).toBeUndefined();
    expect(timeRangeFromDuration("0h", now)).toBeUndefined();
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
    expect(getRefreshIntervalMs("off")).toBeNull();
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
    expect(formatTimeRangeDisplay({ from: "now-7d", to: "now" })).toBe("Last 7 days");
    expect(formatTimeRangeDisplay({ from: "now-1h", to: "now" })).toBe("Last 1 hour");
    expect(formatTimeRangeDisplay({ from: "now/M", to: "now" })).toBe("This month so far");
  });

  it("names a relative range that is not a preset", () => {
    expect(formatTimeRangeDisplay({ from: "now-3h", to: "now" })).toBe("Last 3 hours");
    expect(formatTimeRangeDisplay({ from: "now-1M", to: "now" })).toBe("Last 1 month");
  });

  it("reads two absolute dates as local times, not ISO text", () => {
    const label = formatTimeRangeDisplay({
      from: new Date(2020, 10, 9, 14, 0).toISOString(),
      to: new Date(2020, 10, 10, 18, 30).toISOString(),
    });
    expect(label).toMatch(/Nov 9, 2020.* – Nov 10, 2020/);
    expect(label).not.toMatch(/\dT\d/);
  });

  it("returns the raw expressions for any other range", () => {
    expect(formatTimeRangeDisplay({ from: "now-3h/h", to: "now" })).toBe("now-3h/h to now");
    expect(formatTimeRangeDisplay({ from: "now-3h", to: "now-1h" })).toBe("now-3h to now-1h");
  });
});
