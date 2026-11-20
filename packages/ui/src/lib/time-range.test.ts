import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { DEFAULT_TIME_RANGE, toViewerTimeRange, viewerHistogramWindow } from "./time-range";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("toViewerTimeRange", () => {
  const now = new Date("2026-11-19T15:00:00Z");

  it("resolves Today to the viewer's day", () => {
    vi.stubEnv("TZ", "America/New_York");
    expect(toViewerTimeRange({ from: "now/d", to: "now/d" }, now)).toEqual({
      from: "2026-11-19T05:00:00.000Z",
      to: "2026-11-20T04:59:59.999Z",
    });
  });

  it("resolves both bounds on one clock when only one rounds", () => {
    vi.stubEnv("TZ", "America/New_York");
    expect(toViewerTimeRange({ from: "now/d", to: "now" }, now)).toEqual({
      from: "2026-11-19T05:00:00.000Z",
      to: "2026-11-19T15:00:00.000Z",
    });
  });

  it("leaves a range without rounding for the server's clock", () => {
    expect(toViewerTimeRange({ from: "now-1h", to: "now" }, now)).toEqual({
      from: "now-1h",
      to: "now",
    });
  });

  it("falls back to the default range for a malformed bound", () => {
    expect(toViewerTimeRange({ from: "garbage", to: "now" }, now)).toEqual(DEFAULT_TIME_RANGE);
  });
});

describe("viewerHistogramWindow", () => {
  it("takes the offset in effect now, not past an upcoming DST change", () => {
    // Berlin moves to summer time (UTC+2) on Sunday 2026-03-29; "This week"
    // ends after it, but every bar so far is in winter time (UTC+1).
    vi.stubEnv("TZ", "Europe/Berlin");
    const now = new Date("2026-03-25T12:00:00Z");
    expect(viewerHistogramWindow({ from: "now/w", to: "now/w" }, now).utcOffsetMinutes).toBe(60);
  });
});
