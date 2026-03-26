import { describe, expect, it, vi } from "vitest";
import {
  formatNotificationAbsoluteTime,
  formatNotificationRelativeTime,
} from "./notification-time";

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

  it("returns a safe placeholder for invalid timestamps", () => {
    expect(formatNotificationRelativeTime("not-a-date")).toBe("—");
  });
});
