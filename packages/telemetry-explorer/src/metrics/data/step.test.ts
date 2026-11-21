import { describe, expect, it } from "vite-plus/test";
import { chartClock, clockNow } from "./step";

const at = (iso: string) => Date.parse(iso);
const lastHour = { from: "now-1h", to: "now" };

describe("clockNow", () => {
  it("reads the real now, but never past the clock's bucket, so every query gets the same buckets", () => {
    const clock = chartClock(lastHour, at("2026-06-10T12:00:40Z"), 0);

    expect(clockNow(clock, at("2026-06-10T12:00:50Z")).toISOString()).toBe(
      "2026-06-10T12:00:50.000Z",
    );
    expect(clockNow(clock, at("2026-06-10T12:07:00Z")).toISOString()).toBe(
      "2026-06-10T12:00:59.999Z",
    );
  });

  it("keeps an absolute range off the clock", () => {
    const range = { from: "2026-06-10T11:00:00Z", to: "2026-06-10T12:00:00Z" };
    const clock = chartClock(range, at("2026-06-10T12:00:40Z"), 0);

    expect(clock.bucket).toBeNull();
    expect(clockNow(clock, at("2026-06-10T15:00:00Z")).toISOString()).toBe(
      "2026-06-10T15:00:00.000Z",
    );
  });
});
