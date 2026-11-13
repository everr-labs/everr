import { describe, expect, it, vi } from "vite-plus/test";
import { formatRelativeTime, formatTimestampTimeOfDay, parseTimestampAsUTC } from "./timestamp";

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

describe("formatTimestampTimeOfDay", () => {
  it("returns a placeholder for invalid timestamps", () => {
    expect(formatTimestampTimeOfDay("not-a-date")).toBe("—");
  });

  it("formats a valid timestamp as a localized time string", () => {
    const result = formatTimestampTimeOfDay("2026-03-07T13:32:00Z");
    expect(result).not.toBe("—");
    expect(typeof result).toBe("string");
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
