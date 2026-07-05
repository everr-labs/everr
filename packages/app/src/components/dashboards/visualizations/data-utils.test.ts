import { describe, expect, it } from "vite-plus/test";
import { isNumericValue } from "@/lib/numeric";
import { detectTimeKey, getValueKeys, toNumber, toTimestamp } from "./data-utils";

describe("detectTimeKey", () => {
  it("matches ts, time, and timestamp exactly, case-insensitively", () => {
    expect(detectTimeKey([{ ts: "t", v: 1 }])).toBe("ts");
    expect(detectTimeKey([{ time: "t", v: 1 }])).toBe("time");
    expect(detectTimeKey([{ Timestamp: "t", v: 1 }])).toBe("Timestamp");
  });

  it("does not prefix-match look-alike columns", () => {
    // `timezone` used to match the old /^time.../ prefix pattern and claim a
    // text column as the time axis.
    expect(detectTimeKey([{ timezone: "UTC", v: 1 }])).toBeUndefined();
    expect(detectTimeKey([{ timestamp_label: "a", v: 1 }])).toBeUndefined();
    expect(detectTimeKey([{ ts_count: 3, v: 1 }])).toBeUndefined();
  });

  it("no longer matches the retired alias names", () => {
    for (const name of ["date", "datetime", "created_at", "period", "bucket", "interval"]) {
      expect(detectTimeKey([{ [name]: "t", v: 1 }])).toBeUndefined();
    }
  });

  it("returns undefined for no rows", () => {
    expect(detectTimeKey([])).toBeUndefined();
  });
});

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

  it("passes millisecond epochs through", () => {
    expect(toTimestamp(1717718400000)).toBe(1717718400000);
  });

  it("scales a second epoch (toUnixTimestamp) up to milliseconds", () => {
    // toUnixTimestamp(...) returns seconds; 1717718400 -> 1717718400000 ms.
    expect(toTimestamp(1717718400)).toBe(1717718400000);
  });

  it("treats a bare numeric string as an epoch (seconds or ms)", () => {
    expect(toTimestamp("1717718400")).toBe(1717718400000); // seconds
    expect(toTimestamp("1717718400000")).toBe(1717718400000); // ms
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

  it("returns null for unparseable input (0 would be a valid 1970 instant)", () => {
    expect(toTimestamp("not a date")).toBeNull();
    expect(toTimestamp(null)).toBeNull();
    expect(toTimestamp(Number.NaN)).toBeNull();
  });
});

describe("getValueKeys", () => {
  it("includes quoted-integer columns and excludes the time key and text dimensions", () => {
    const rows = [{ time: "2026-06-07T00:00:00", count: "42", service: "api" }];
    expect(getValueKeys(rows, "time")).toEqual(["count"]);
  });

  it("includes real number columns", () => {
    expect(getValueKeys([{ time: "t", value: 1.5 }], "time")).toEqual(["value"]);
  });

  it("detects a column that is NULL in the first row but numeric later", () => {
    // ClickHouse returns NULL for the leading bucket of an aggregate with no
    // events yet; the column must still be recognized as a value column.
    const rows = [
      { time: "t0", p99: null },
      { time: "t1", p99: 12.5 },
    ];
    expect(getValueKeys(rows, "time")).toEqual(["p99"]);
  });

  it("excludes a column that is never numeric in any row", () => {
    const rows = [
      { time: "t0", label: null },
      { time: "t1", label: "api" },
    ];
    expect(getValueKeys(rows, "time")).toEqual([]);
  });

  it("returns an empty array for no rows", () => {
    expect(getValueKeys([], "time")).toEqual([]);
  });
});
