import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { toViewerTimeRange, viewerBucketWindow } from "./time-range";

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
