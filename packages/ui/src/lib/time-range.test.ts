import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { DEFAULT_TIME_RANGE, toViewerTimeRange } from "./time-range";

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

  it("leaves bounds without rounding for the server's clock", () => {
    vi.stubEnv("TZ", "America/New_York");
    expect(toViewerTimeRange({ from: "now/d", to: "now" }, now)).toEqual({
      from: "2026-11-19T05:00:00.000Z",
      to: "now",
    });
  });

  it("falls back to the default range for a malformed bound", () => {
    expect(toViewerTimeRange({ from: "garbage", to: "now" }, now)).toEqual(DEFAULT_TIME_RANGE);
  });
});
