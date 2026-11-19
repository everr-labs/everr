import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { toAbsoluteTimeRange } from "./time-range";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("toAbsoluteTimeRange", () => {
  const now = new Date("2026-11-19T15:00:00Z");

  it("resolves Today to the viewer's day", () => {
    vi.stubEnv("TZ", "America/New_York");
    expect(toAbsoluteTimeRange({ from: "now/d", to: "now/d" }, now)).toEqual({
      from: "2026-11-19T05:00:00.000Z",
      to: "2026-11-20T04:59:59.999Z",
    });
  });

  it("leaves a relative range the same in every zone", () => {
    vi.stubEnv("TZ", "Asia/Kolkata");
    expect(toAbsoluteTimeRange({ from: "now-1h", to: "now" }, now)).toEqual({
      from: "2026-11-19T14:00:00.000Z",
      to: "2026-11-19T15:00:00.000Z",
    });
  });
});
