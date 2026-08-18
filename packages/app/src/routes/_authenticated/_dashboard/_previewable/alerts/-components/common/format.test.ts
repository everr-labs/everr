import { describe, expect, it } from "vitest";
import { alertingFormatTs } from "./format";

describe("alertingFormatTs", () => {
  it("uses a day-first date and 24-hour clock", () => {
    expect(alertingFormatTs(new Date("2026-08-06T12:47:33Z"))).toMatch(
      /^\d{2} Aug 2026, \d{2}:\d{2}:33$/,
    );
  });

  it("treats a zone-less ClickHouse timestamp as UTC", () => {
    // Same instant whether or not the string carries its Z.
    expect(alertingFormatTs("2026-08-06 12:47:33")).toBe(
      alertingFormatTs("2026-08-06T12:47:33Z"),
    );
  });
});
