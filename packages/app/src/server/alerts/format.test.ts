import { describe, expect, it } from "vitest";
import { extractInstanceValues, formatDuration } from "./format";

const at = (iso: string) => new Date(iso);

describe("formatDuration", () => {
  it("formats sub-minute, minutes, hours, and days", () => {
    const from = at("2026-06-12T10:00:00Z");
    expect(formatDuration(from, at("2026-06-12T10:00:30Z"))).toBe("<1m");
    expect(formatDuration(from, at("2026-06-12T10:42:00Z"))).toBe("42m");
    expect(formatDuration(from, at("2026-06-12T13:12:00Z"))).toBe("3h 12m");
    expect(formatDuration(from, at("2026-06-12T13:00:00Z"))).toBe("3h");
    expect(formatDuration(from, at("2026-06-14T14:00:00Z"))).toBe("2d 4h");
    expect(formatDuration(from, at("2026-06-14T10:00:00Z"))).toBe("2d");
  });
});

describe("extractInstanceValues", () => {
  it("keeps numeric non-label columns, including numeric strings", () => {
    expect(
      extractInstanceValues(
        { route: "/a", error_rate: 7.2, error_count: "12", note: "n/a" },
        { route: "/a" },
      ),
    ).toEqual(["error_rate: 7.2", "error_count: 12"]);
  });

  it("caps at three values and handles missing rows", () => {
    expect(extractInstanceValues({ a: 1, b: 2, c: 3, d: 4 }, {})).toEqual([
      "a: 1",
      "b: 2",
      "c: 3",
    ]);
    expect(extractInstanceValues(undefined, {})).toEqual([]);
  });
});
