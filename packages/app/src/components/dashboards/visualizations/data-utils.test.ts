import { describe, expect, it } from "vitest";
import {
  getValueKeys,
  isNumericValue,
  toNumber,
  toTimestamp,
} from "./data-utils";

describe("isNumericValue", () => {
  it("accepts numbers and numeric strings", () => {
    expect(isNumericValue(42)).toBe(true);
    expect(isNumericValue(0)).toBe(true);
    expect(isNumericValue(-1.5)).toBe(true);
    // ClickHouse JSONEachRow encodes 64-bit ints as quoted strings.
    expect(isNumericValue("42")).toBe(true);
    expect(isNumericValue("  7 ")).toBe(true);
    expect(isNumericValue("3.14")).toBe(true);
  });

  it("rejects non-numeric strings, empty, null, and non-finite", () => {
    expect(isNumericValue("api")).toBe(false);
    expect(isNumericValue("")).toBe(false);
    expect(isNumericValue("  ")).toBe(false);
    expect(isNumericValue(null)).toBe(false);
    expect(isNumericValue(true)).toBe(false);
    expect(isNumericValue(Number.NaN)).toBe(false);
  });
});

describe("toNumber", () => {
  it("coerces numbers and numeric strings, null otherwise", () => {
    expect(toNumber(42)).toBe(42);
    expect(toNumber("42")).toBe(42);
    expect(toNumber("3.14")).toBe(3.14);
    expect(toNumber("api")).toBeNull();
    expect(toNumber("")).toBeNull();
    expect(toNumber(null)).toBeNull();
    expect(toNumber(Number.NaN)).toBeNull();
  });
});

describe("toTimestamp", () => {
  const utc = Date.UTC(2026, 5, 7, 0, 0, 0); // 2026-06-07T00:00:00Z

  it("passes numbers through", () => {
    expect(toTimestamp(1717718400000)).toBe(1717718400000);
  });

  it("treats space-separated ClickHouse DateTime as UTC", () => {
    expect(toTimestamp("2026-06-07 00:00:00")).toBe(utc);
  });

  it("parses values that already carry a Z timezone (no double-Z)", () => {
    expect(toTimestamp("2026-06-07T00:00:00Z")).toBe(utc);
  });

  it("parses values with a numeric UTC offset", () => {
    // +02:00 is two hours ahead of UTC, so the instant is two hours earlier.
    expect(toTimestamp("2026-06-07T02:00:00+02:00")).toBe(utc);
  });

  it("parses a date-only value as UTC midnight", () => {
    expect(toTimestamp("2026-06-07")).toBe(utc);
  });

  it("returns 0 for unparseable input", () => {
    expect(toTimestamp("not a date")).toBe(0);
    expect(toTimestamp(null)).toBe(0);
  });
});

describe("getValueKeys", () => {
  it("includes quoted-integer columns and excludes the time key and text dimensions", () => {
    const row = { time: "2026-06-07T00:00:00", count: "42", service: "api" };
    expect(getValueKeys(row, "time")).toEqual(["count"]);
  });

  it("includes real number columns", () => {
    expect(getValueKeys({ time: "t", value: 1.5 }, "time")).toEqual(["value"]);
  });
});
