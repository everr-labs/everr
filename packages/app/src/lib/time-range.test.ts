import { getRefreshIntervalMs } from "@everr/ui/components/refresh-picker";
import { formatTimeRangeDisplay } from "@everr/ui/components/time-range-picker";
import {
  DEFAULT_TIME_RANGE,
  resolveTimeRange,
  TimeRangeSchema,
  withTimeRange,
} from "@everr/ui/lib/time-range";
import { describe, expect, it } from "vitest";
import {
  applyRouteTimeDefaults,
  ResolvedTimeRangeSearchSchema,
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

describe("applyRouteTimeDefaults", () => {
  const defaults = { from: "now-24h", to: "now", refresh: "30s" };

  it("applies the default range when the URL has no range", () => {
    expect(applyRouteTimeDefaults({}, defaults)).toEqual({
      from: "now-24h",
      to: "now",
      refresh: "30s",
    });
  });

  it("lets explicit URL from/to win over the default range", () => {
    expect(
      applyRouteTimeDefaults({ from: "now-7d", to: "now" }, defaults),
    ).toEqual({ from: "now-7d", to: "now", refresh: "30s" });
  });

  it("does not mix a half-specified URL range with the default", () => {
    // Only `from` in the URL: keep the URL pair as-is (let the resolver fill the
    // global default for `to`), never graft on the default `to`.
    expect(applyRouteTimeDefaults({ from: "now-2d" }, defaults)).toEqual({
      from: "now-2d",
      to: undefined,
      refresh: "30s",
    });
  });

  it("lets an explicit refresh win over the default", () => {
    expect(applyRouteTimeDefaults({ refresh: "5s" }, defaults)).toEqual({
      from: "now-24h",
      to: "now",
      refresh: "5s",
    });
  });

  it("lets an explicit off win over the default", () => {
    // `??` (not `||`) — "off" is an explicit choice and must not re-arm the
    // default. (`||` would have treated a falsy/empty refresh as "unset".)
    expect(applyRouteTimeDefaults({ refresh: "off" }, defaults)).toEqual({
      from: "now-24h",
      to: "now",
      refresh: "off",
    });
  });

  it("is a no-op when there are no defaults", () => {
    expect(applyRouteTimeDefaults({ from: "now-1h", to: "now" }, {})).toEqual({
      from: "now-1h",
      to: "now",
      refresh: undefined,
    });
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
