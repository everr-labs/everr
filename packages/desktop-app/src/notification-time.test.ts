import { describe, expect, it, vi } from "vitest";
import {
  formatNotificationAbsoluteTime,
  formatNotificationRelativeTime,
  getNotificationTimeParts,
  parseNotificationTimestamp,
} from "./notification-time";

describe("parseNotificationTimestamp", () => {
  it("parses an ISO timestamp with Z suffix", () => {
    const result = parseNotificationTimestamp("2026-03-07T13:32:00Z");
    expect(result).toBeInstanceOf(Date);
    expect(result!.toISOString()).toBe("2026-03-07T13:32:00.000Z");
  });

  it("parses an ISO timestamp with a timezone offset", () => {
    const result = parseNotificationTimestamp("2026-03-07T14:32:00+01:00");
    expect(result).toBeInstanceOf(Date);
    expect(result!.toISOString()).toBe("2026-03-07T13:32:00.000Z");
  });

  it("parses a ClickHouse space-separated timestamp as UTC", () => {
    const result = parseNotificationTimestamp("2026-03-07 13:32:00");
    expect(result).toBeInstanceOf(Date);
    expect(result!.toISOString()).toBe("2026-03-07T13:32:00.000Z");
  });

  it("trims whitespace around the input", () => {
    const result = parseNotificationTimestamp("  2026-03-07T13:32:00Z  ");
    expect(result).toBeInstanceOf(Date);
    expect(result!.toISOString()).toBe("2026-03-07T13:32:00.000Z");
  });

  it("returns null for an invalid string", () => {
    expect(parseNotificationTimestamp("not-a-date")).toBeNull();
  });

  it("returns null for an empty string", () => {
    expect(parseNotificationTimestamp("")).toBeNull();
  });
});

describe("getNotificationTimeParts", () => {
  it("returns absolute time and null timeZoneName", () => {
    const parts = getNotificationTimeParts("2026-03-07T13:32:00Z", {
      locale: "en-GB",
      timeZone: "UTC",
    });
    expect(parts.absolute).toBe("13:32");
    expect(parts.timeZoneName).toBeNull();
  });

  it("returns a placeholder for invalid timestamps", () => {
    const parts = getNotificationTimeParts("garbage");
    expect(parts.absolute).toBe("—");
    expect(parts.timeZoneName).toBeNull();
  });
});

describe("formatNotificationAbsoluteTime", () => {
  it("renders HH:MM in 24-hour format", () => {
    expect(
      formatNotificationAbsoluteTime("2026-03-07T13:32:00Z", {
        locale: "en-GB",
        timeZone: "UTC",
      }),
    ).toBe("13:32");
  });

  it("respects the provided timezone when formatting HH:MM", () => {
    expect(
      formatNotificationAbsoluteTime("2026-03-07T13:32:00Z", {
        locale: "en-GB",
        timeZone: "Europe/Rome",
      }),
    ).toBe("14:32");
  });

  it("treats timezone-less ClickHouse timestamps as UTC before local conversion", () => {
    const options = {
      locale: "en-GB",
      timeZone: "Europe/Rome",
    } satisfies Parameters<typeof formatNotificationAbsoluteTime>[1];

    expect(formatNotificationAbsoluteTime("2026-03-07 13:32:00", options)).toBe(
      formatNotificationAbsoluteTime("2026-03-07T13:32:00Z", options),
    );
  });

  it("returns a safe placeholder for invalid timestamps", () => {
    expect(formatNotificationAbsoluteTime("not-a-date")).toBe("—");
  });
});

describe("formatNotificationRelativeTime", () => {
  it("renders relative minutes", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-07T13:35:00Z"));

    expect(formatNotificationRelativeTime("2026-03-07T13:32:00Z")).toBe(
      "3m ago",
    );
  });

  it("treats timezone-less ISO timestamps as UTC", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-07T13:35:00Z"));

    expect(formatNotificationRelativeTime("2026-03-07T13:32:00")).toBe(
      "3m ago",
    );
  });

  it("returns 'just now' for timestamps less than a minute ago", () => {
    const now = new Date("2026-03-07T13:32:30Z");
    expect(
      formatNotificationRelativeTime("2026-03-07T13:32:00Z", { now }),
    ).toBe("just now");
  });

  it("returns 'just now' for future timestamps", () => {
    const now = new Date("2026-03-07T13:30:00Z");
    expect(
      formatNotificationRelativeTime("2026-03-07T13:35:00Z", { now }),
    ).toBe("just now");
  });

  it("renders relative hours", () => {
    const now = new Date("2026-03-07T16:32:00Z");
    expect(
      formatNotificationRelativeTime("2026-03-07T13:32:00Z", { now }),
    ).toBe("3h ago");
  });

  it("renders relative days", () => {
    const now = new Date("2026-03-10T13:32:00Z");
    expect(
      formatNotificationRelativeTime("2026-03-07T13:32:00Z", { now }),
    ).toBe("3d ago");
  });

  it("returns a safe placeholder for invalid timestamps", () => {
    expect(formatNotificationRelativeTime("not-a-date")).toBe("—");
  });
});
