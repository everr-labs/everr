import { describe, expect, it } from "vitest";
import { getValueKeys, isNumericValue, toNumber } from "./data-utils";

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

describe("getValueKeys", () => {
  it("includes quoted-integer columns and excludes the time key and text dimensions", () => {
    const row = { time: "2026-06-07T00:00:00", count: "42", service: "api" };
    expect(getValueKeys(row, "time")).toEqual(["count"]);
  });

  it("includes real number columns", () => {
    expect(getValueKeys({ time: "t", value: 1.5 }, "time")).toEqual(["value"]);
  });
});
