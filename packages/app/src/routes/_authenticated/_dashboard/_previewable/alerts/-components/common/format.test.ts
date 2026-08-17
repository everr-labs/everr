import { describe, expect, it } from "vitest";
import { alertingFormatTs } from "./format";

describe("alertingFormatTs", () => {
  it("uses a day-first date and 24-hour clock", () => {
    expect(alertingFormatTs("2026-08-06T12:47:33")).toBe(
      "06 Aug 2026, 12:47:33",
    );
  });
});
