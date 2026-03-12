import { describe, expect, it, vi } from "vitest";
import {
  formatDuration,
  formatDurationCompact,
  formatRelativeTime,
  formatTimestampTimeOfDay,
  getFailureRateColor,
  getSuccessRateVariant,
  normalizeTimestampToUtc,
  parseDuration,
  parseTimestampAsUTC,
  testNameLastSegment,
  testNameSeparator,
} from "./formatting";

describe("formatDuration", () => {
  it("formats milliseconds under 1s", () => {
    expect(formatDuration(500, "ms")).toBe("500ms");
    expect(formatDuration(0, "ms")).toBe("0ms");
    expect(formatDuration(999, "ms")).toBe("999ms");
  });

  it("formats seconds under 60s", () => {
    expect(formatDuration(1000, "ms")).toBe("1.0s");
    expect(formatDuration(5, "s")).toBe("5.0s");
    expect(formatDuration(59.9, "s")).toBe("59.9s");
  });

  it("formats minutes and seconds", () => {
    expect(formatDuration(60, "s")).toBe("1m 0s");
    expect(formatDuration(90, "s")).toBe("1m 30s");
    expect(formatDuration(3661, "s")).toBe("61m 1s");
  });

  it("defaults to seconds unit", () => {
    expect(formatDuration(5)).toBe("5.0s");
    expect(formatDuration(90)).toBe("1m 30s");
  });

  it("converts nanoseconds", () => {
    expect(formatDuration(5_000_000_000, "ns")).toBe("5.0s");
    expect(formatDuration(500_000, "ns")).toBe("1ms");
  });

  it("rounds milliseconds", () => {
    expect(formatDuration(1.7, "ms")).toBe("2ms");
    expect(formatDuration(0.3, "ms")).toBe("0ms");
  });
});

describe("formatDurationCompact", () => {
  it("formats milliseconds under 1s", () => {
    expect(formatDurationCompact(500)).toBe("500ms");
    expect(formatDurationCompact(0)).toBe("0ms");
  });

  it("formats seconds under 60s", () => {
    expect(formatDurationCompact(1000)).toBe("1.0s");
    expect(formatDurationCompact(5500)).toBe("5.5s");
  });

  it("formats minutes", () => {
    expect(formatDurationCompact(60000)).toBe("1.0m");
    expect(formatDurationCompact(90000)).toBe("1.5m");
  });

  it("converts from seconds unit", () => {
    expect(formatDurationCompact(5, "s")).toBe("5.0s");
    expect(formatDurationCompact(90, "s")).toBe("1.5m");
  });
});

describe("getSuccessRateVariant", () => {
  it("returns default for high rates", () => {
    expect(getSuccessRateVariant(100)).toBe("default");
    expect(getSuccessRateVariant(80)).toBe("default");
  });

  it("returns secondary for fair rates", () => {
    expect(getSuccessRateVariant(79)).toBe("secondary");
    expect(getSuccessRateVariant(50)).toBe("secondary");
  });

  it("returns destructive for low rates", () => {
    expect(getSuccessRateVariant(49)).toBe("destructive");
    expect(getSuccessRateVariant(0)).toBe("destructive");
  });

  it("supports custom thresholds", () => {
    expect(getSuccessRateVariant(90, { good: 95, fair: 70 })).toBe("secondary");
    expect(getSuccessRateVariant(60, { good: 95, fair: 70 })).toBe(
      "destructive",
    );
  });
});

describe("getFailureRateColor", () => {
  it("returns red for high failure rates", () => {
    expect(getFailureRateColor(50)).toBe("text-red-600");
    expect(getFailureRateColor(100)).toBe("text-red-600");
  });

  it("returns orange for medium failure rates", () => {
    expect(getFailureRateColor(20)).toBe("text-orange-500");
    expect(getFailureRateColor(49)).toBe("text-orange-500");
  });

  it("returns yellow for low failure rates", () => {
    expect(getFailureRateColor(19)).toBe("text-yellow-600");
    expect(getFailureRateColor(0)).toBe("text-yellow-600");
  });
});

describe("parseDuration", () => {
  it("parses plain numbers as milliseconds", () => {
    expect(parseDuration("500")).toBe(500);
    expect(parseDuration("0")).toBe(0);
    expect(parseDuration("1.5")).toBe(1.5);
  });

  it("parses milliseconds", () => {
    expect(parseDuration("200ms")).toBe(200);
  });

  it("parses seconds", () => {
    expect(parseDuration("1s")).toBe(1000);
    expect(parseDuration("1.5s")).toBe(1500);
  });

  it("parses minutes", () => {
    expect(parseDuration("2m")).toBe(120000);
  });

  it("parses combined durations", () => {
    expect(parseDuration("1m30s")).toBe(90000);
    expect(parseDuration("1m 30s")).toBe(90000);
    expect(parseDuration("1m30s200ms")).toBe(90200);
  });

  it("returns null for empty or invalid input", () => {
    expect(parseDuration("")).toBeNull();
    expect(parseDuration("   ")).toBeNull();
    expect(parseDuration("abc")).toBeNull();
  });
});

describe("formatRelativeTime", () => {
  it("returns 'just now' for less than a minute", () => {
    const now = new Date();
    expect(formatRelativeTime(now.toISOString())).toBe("just now");
  });

  it("returns minutes ago", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-01-01T12:05:00Z"));
    expect(formatRelativeTime("2025-01-01T12:00:00Z")).toBe("5m ago");
    vi.useRealTimers();
  });

  it("returns hours ago", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-01-01T15:00:00Z"));
    expect(formatRelativeTime("2025-01-01T12:00:00Z")).toBe("3h ago");
    vi.useRealTimers();
  });

  it("returns days ago", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-01-03T12:00:00Z"));
    expect(formatRelativeTime("2025-01-01T12:00:00Z")).toBe("2d ago");
    vi.useRealTimers();
  });

  it("treats timezone-less ClickHouse timestamps as UTC", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-01-01T12:05:00Z"));
    expect(formatRelativeTime("2025-01-01 12:00:00")).toBe("5m ago");
    vi.useRealTimers();
  });

  it("treats timezone-less ISO timestamps as UTC", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-01-01T12:05:00Z"));
    expect(formatRelativeTime("2025-01-01T12:00:00")).toBe("5m ago");
    vi.useRealTimers();
  });

  it("returns a safe placeholder for invalid timestamps", () => {
    expect(formatRelativeTime("not-a-date")).toBe("—");
  });
});

describe("parseTimestampAsUTC", () => {
  it("treats timezone-less ClickHouse timestamps as UTC", () => {
    expect(parseTimestampAsUTC("2025-01-01 12:00:00")?.toISOString()).toBe(
      "2025-01-01T12:00:00.000Z",
    );
  });

  it("treats timezone-less ISO timestamps as UTC", () => {
    expect(parseTimestampAsUTC("2025-01-01T12:00:00")?.toISOString()).toBe(
      "2025-01-01T12:00:00.000Z",
    );
  });

  it("preserves explicit timezone offsets", () => {
    expect(
      parseTimestampAsUTC("2025-01-01T13:00:00+01:00")?.toISOString(),
    ).toBe("2025-01-01T12:00:00.000Z");
  });

  it("returns null for invalid timestamps", () => {
    expect(parseTimestampAsUTC("not-a-date")).toBeNull();
  });
});

describe("normalizeTimestampToUtc", () => {
  it("returns timezone-aware UTC timestamps", () => {
    expect(normalizeTimestampToUtc("2025-01-01 12:00:00.123")).toBe(
      "2025-01-01T12:00:00.123Z",
    );
  });

  it("leaves invalid timestamps unchanged", () => {
    expect(normalizeTimestampToUtc("not-a-date")).toBe("not-a-date");
  });
});

describe("formatTimestampTimeOfDay", () => {
  it("returns a safe placeholder for invalid timestamps", () => {
    expect(formatTimestampTimeOfDay("not-a-date")).toBe("—");
  });
});

describe("testNameSeparator", () => {
  it("detects Vitest, Rust, and Go hierarchies", () => {
    expect(testNameSeparator("pkg > suite > test")).toBe(" > ");
    expect(testNameSeparator("suite::nested::test")).toBe("::");
    expect(testNameSeparator("Suite/SubTest")).toBe("/");
  });
});

describe("testNameLastSegment", () => {
  it("returns the last segment across supported test hierarchies", () => {
    expect(testNameLastSegment("pkg > suite > test")).toBe("test");
    expect(testNameLastSegment("suite::nested::test")).toBe("test");
    expect(testNameLastSegment("Suite/SubTest")).toBe("SubTest");
  });
});
