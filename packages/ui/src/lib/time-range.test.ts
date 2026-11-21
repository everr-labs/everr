import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import {
  applyRouteTimeDefaults,
  inViewerTimeRange,
  toViewerTimeRange,
  viewerBucketWindow,
} from "./time-range";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("toViewerTimeRange", () => {
  const now = new Date("2026-11-19T15:00:00Z");

  it("falls back to the last 7 days for a malformed bound", () => {
    expect(toViewerTimeRange({ from: "garbage", to: "now" }, now)).toEqual({
      from: "2026-11-12T15:00:00.000Z",
      to: "2026-11-19T15:00:00.000Z",
    });
  });
});

describe("viewerBucketWindow", () => {
  it("takes the offset in effect now, not past an upcoming DST change", () => {
    // Berlin moves to summer time (UTC+2) on Sunday 2026-03-29; "This week"
    // ends after it, but every bar so far is in winter time (UTC+1).
    vi.stubEnv("TZ", "Europe/Berlin");
    const now = new Date("2026-03-25T12:00:00Z");
    expect(viewerBucketWindow({ from: "now/w", to: "now/w" }, now).utcOffsetMinutes).toBe(60);
  });
});

describe("inViewerTimeRange", () => {
  // Today until five hours ago: nothing before 05:00.
  const range = { from: "now/d", to: "now-5h" };

  it("gives the empty value without fetching when the range ends before it starts", async () => {
    vi.stubEnv("TZ", "UTC");
    const fetch = vi.fn(async () => ["row"]);
    expect(await inViewerTimeRange(range, [], fetch, new Date("2026-11-19T02:00:00Z"))).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("fetches with the range resolved in the viewer's zone otherwise", async () => {
    vi.stubEnv("TZ", "UTC");
    const fetch = vi.fn(async () => ["row"]);
    expect(await inViewerTimeRange(range, [], fetch, new Date("2026-11-19T15:00:00Z"))).toEqual([
      "row",
    ]);
    expect(fetch).toHaveBeenCalledWith({
      from: "2026-11-19T00:00:00.000Z",
      to: "2026-11-19T10:00:00.000Z",
    });
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
    expect(applyRouteTimeDefaults({ from: "now-7d", to: "now" }, defaults)).toEqual({
      from: "now-7d",
      to: "now",
      refresh: "30s",
    });
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
    // `??` (not `||`): "off" is an explicit choice and must not re-arm the
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
