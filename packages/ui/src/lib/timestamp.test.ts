import { describe, expect, it, vi } from "vite-plus/test";
import {
  formatRelativeTime,
  formatClock,
  formatDay,
  formatWindowBounds,
  parseTimestampAsUTC,
  formatRowTimestamp,
} from "./timestamp";
import { rangeSpansDays } from "./time-range";

describe("parseTimestampAsUTC", () => {
  it.each([
    ["an ISO timestamp with Z suffix", "2026-03-07T13:32:00Z", "2026-03-07T13:32:00.000Z"],
    [
      "an ISO timestamp with a timezone offset",
      "2026-03-07T14:32:00+01:00",
      "2026-03-07T13:32:00.000Z",
    ],
    ["a timezone offset without a colon", "2026-03-07T14:32:00+0100", "2026-03-07T13:32:00.000Z"],
    [
      "a ClickHouse space-separated timestamp as UTC",
      "2026-03-07 13:32:00",
      "2026-03-07T13:32:00.000Z",
    ],
    [
      "a lowercase-t separator as UTC (not local time)",
      "2026-03-07t13:32:00",
      "2026-03-07T13:32:00.000Z",
    ],
    ["input with surrounding whitespace", "  2026-03-07T13:32:00Z  ", "2026-03-07T13:32:00.000Z"],
    ["a date-only value as UTC midnight", "2026-03-07", "2026-03-07T00:00:00.000Z"],
  ])("parses %s", (_, input, iso) => {
    expect(parseTimestampAsUTC(input)?.toISOString()).toBe(iso);
  });

  it("returns null for an invalid or empty string", () => {
    expect(parseTimestampAsUTC("not-a-date")).toBeNull();
    expect(parseTimestampAsUTC("")).toBeNull();
  });
});

describe("time formatting", () => {
  it("is a zero-padded 24h clock, with no AM/PM", () => {
    const at = new Date(2026, 2, 7, 4, 5, 6, 78);
    expect(formatClock(at, "minute")).toBe("04:05");
    expect(formatClock(at, "millisecond")).toBe("04:05:06.078");
    expect(formatClock(new Date(2026, 2, 7, 14, 54, 11))).toBe("14:54:11");
    expect(formatClock("not-a-date")).toBe("—");
  });

  it("shows the year only when it is not this year, unless told otherwise", () => {
    vi.useFakeTimers({ now: new Date(2026, 5, 1) });
    expect(formatDay(new Date(2026, 10, 10))).toBe("Nov 10");
    expect(formatDay(new Date(2025, 10, 10))).toBe("Nov 10, 2025");
    expect(formatDay(new Date(2026, 10, 10), "always")).toBe("Nov 10, 2026");
    vi.useRealTimers();
  });

  it("prints a window's end date only when it differs from the start's", () => {
    const at = (d: number, h: number) => new Date(2026, 10, d, h);
    expect(formatWindowBounds(at(10, 14), at(10, 16), "minute")).toEqual([
      "Nov 10, 14:00",
      "16:00",
    ]);
    expect(formatWindowBounds(at(10, 22), at(11, 2), "minute")).toEqual([
      "Nov 10, 22:00",
      "Nov 11, 02:00",
    ]);
  });
});

describe("formatRelativeTime", () => {
  it("returns a placeholder for invalid timestamps", () => {
    expect(formatRelativeTime("not-a-date")).toBe("—");
  });

  it.each([
    ["2026-03-07T13:32:30Z", "just now"],
    // A future timestamp also reads as just now.
    ["2026-03-07T13:30:00Z", "just now"],
    ["2026-03-07T13:35:00Z", "3m ago"],
    ["2026-03-07T16:32:00Z", "3h ago"],
    ["2026-03-10T13:32:00Z", "3d ago"],
  ])("at %s renders 2026-03-07T13:32:00Z as %s", (now, expected) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(now));
    expect(formatRelativeTime("2026-03-07T13:32:00Z")).toBe(expected);
    vi.useRealTimers();
  });
});

describe("formatRowTimestamp", () => {
  const at = new Date(2026, 10, 10, 14, 54, 11);

  it("gives the time alone, or the day too when asked", () => {
    expect(formatRowTimestamp(at.toISOString(), false)).toBe("14:54:11");
    expect(formatRowTimestamp(at.toISOString(), true)).toBe("Nov 10, 14:54:11");
  });
});

describe("rangeSpansDays", () => {
  const now = new Date(2026, 10, 16, 15, 0);

  it("is false within one day, true across days", () => {
    expect(rangeSpansDays({ from: "now-1h", to: "now" }, now)).toBe(false);
    expect(rangeSpansDays({ from: "now/d", to: "now/d" }, now)).toBe(false);
    expect(rangeSpansDays({ from: "now-24h", to: "now" }, now)).toBe(true);
    expect(rangeSpansDays({ from: "now-7d", to: "now" }, now)).toBe(true);
  });

  it("ends a range that stops at midnight on the day before", () => {
    const from = new Date(2026, 10, 10).toISOString();
    const to = new Date(2026, 10, 11).toISOString();
    expect(rangeSpansDays({ from, to }, now)).toBe(false);
  });
});
