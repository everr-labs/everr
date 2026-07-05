import { describe, expect, it, vi } from "vite-plus/test";
import { formatRelativeTime, formatTimestampTimeOfDay, parseTimestampAsUTC } from "./timestamp";

describe("parseTimestampAsUTC", () => {
  it("parses an ISO timestamp with Z suffix", () => {
    const result = parseTimestampAsUTC("2026-03-07T13:32:00Z");
    expect(result).toBeInstanceOf(Date);
    expect(result!.toISOString()).toBe("2026-03-07T13:32:00.000Z");
  });

  it("parses an ISO timestamp with a timezone offset", () => {
    const result = parseTimestampAsUTC("2026-03-07T14:32:00+01:00");
    expect(result).toBeInstanceOf(Date);
    expect(result!.toISOString()).toBe("2026-03-07T13:32:00.000Z");
  });

  it("parses a ClickHouse space-separated timestamp as UTC", () => {
    const result = parseTimestampAsUTC("2026-03-07 13:32:00");
    expect(result).toBeInstanceOf(Date);
    expect(result!.toISOString()).toBe("2026-03-07T13:32:00.000Z");
  });

  it("parses a lowercase-t separator as UTC (not local time)", () => {
    const result = parseTimestampAsUTC("2026-03-07t13:32:00");
    expect(result).toBeInstanceOf(Date);
    expect(result!.toISOString()).toBe("2026-03-07T13:32:00.000Z");
  });

  it("trims whitespace around the input", () => {
    const result = parseTimestampAsUTC("  2026-03-07T13:32:00Z  ");
    expect(result).toBeInstanceOf(Date);
    expect(result!.toISOString()).toBe("2026-03-07T13:32:00.000Z");
  });

  it("parses a date-only value as UTC midnight", () => {
    const result = parseTimestampAsUTC("2026-03-07");
    expect(result).toBeInstanceOf(Date);
    expect(result!.toISOString()).toBe("2026-03-07T00:00:00.000Z");
  });

  it("parses a timezone offset without a colon", () => {
    const result = parseTimestampAsUTC("2026-03-07T14:32:00+0100");
    expect(result).toBeInstanceOf(Date);
    expect(result!.toISOString()).toBe("2026-03-07T13:32:00.000Z");
  });

  it("returns null for an invalid string", () => {
    expect(parseTimestampAsUTC("not-a-date")).toBeNull();
  });

  it("returns null for an empty string", () => {
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

  it("returns 'just now' for timestamps less than a minute ago", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-07T13:32:30Z"));
    expect(formatRelativeTime("2026-03-07T13:32:00Z")).toBe("just now");
    vi.useRealTimers();
  });

  it("returns 'just now' for future timestamps", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-07T13:30:00Z"));
    expect(formatRelativeTime("2026-03-07T13:35:00Z")).toBe("just now");
    vi.useRealTimers();
  });

  it("renders relative minutes", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-07T13:35:00Z"));
    expect(formatRelativeTime("2026-03-07T13:32:00Z")).toBe("3m ago");
    vi.useRealTimers();
  });

  it("renders relative hours", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-07T16:32:00Z"));
    expect(formatRelativeTime("2026-03-07T13:32:00Z")).toBe("3h ago");
    vi.useRealTimers();
  });

  it("renders relative days", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-10T13:32:00Z"));
    expect(formatRelativeTime("2026-03-07T13:32:00Z")).toBe("3d ago");
    vi.useRealTimers();
  });
});
