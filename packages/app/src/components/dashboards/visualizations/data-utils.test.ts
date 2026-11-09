import { describe, expect, it } from "vite-plus/test";
import { isNumericValue } from "#app/lib/numeric.ts";
import {
  detectTimeKey,
  getValueKeys,
  nearestSampleIndex,
  bucketIndexAt,
  niceLinearDomain,
  toNumber,
  toTimestamp,
} from "./data-utils";

describe("detectTimeKey", () => {
  it.each([
    [{ ts: "t" }, "ts"],
    [{ time: "t" }, "time"],
    [{ Timestamp: "t" }, "Timestamp"],
    // Similar prefixes do not make a column temporal.
    [{ timezone: "UTC" }, undefined],
    [{ timestamp_label: "a" }, undefined],
    [{ ts_count: 3 }, undefined],
  ])("finds the time column of %o", (row, expected) => {
    expect(detectTimeKey([{ ...row, v: 1 }])).toBe(expected);
  });
});

describe("isNumericValue and toNumber", () => {
  it.each([
    [42, 42],
    [-1.5, -1.5],
    // ClickHouse JSONEachRow encodes 64-bit ints as quoted strings.
    ["42", 42],
    ["  7 ", 7],
    ["3.14", 3.14],
    ["api", null],
    ["", null],
    ["  ", null],
    [null, null],
    [true, null],
    [Number.NaN, null],
  ])("reads %o as %o", (value, expected) => {
    expect(toNumber(value)).toBe(expected);
    expect(isNumericValue(value)).toBe(expected !== null);
  });
});

describe("toTimestamp", () => {
  const utc = Date.UTC(2026, 5, 7, 0, 0, 0); // 2026-06-07T00:00:00Z

  it.each([
    ["a millisecond epoch", utc, utc],
    // toUnixTimestamp(...) returns seconds.
    ["a second epoch", utc / 1000, utc],
    ["a numeric string in seconds", String(utc / 1000), utc],
    ["a numeric string in milliseconds", String(utc), utc],
    ["a ClickHouse DateTime, as UTC", "2026-06-07 00:00:00", utc],
    ["an ISO time in UTC", "2026-06-07T00:00:00Z", utc],
    ["an ISO time with an offset", "2026-06-07T02:00:00+02:00", utc],
    ["a date, as UTC midnight", "2026-06-07", utc],
    // Not 0: that would be a valid 1970 instant.
    ["text that is no time", "not a date", null],
    ["null", null, null],
    ["NaN", Number.NaN, null],
  ])("reads %s", (_, value, expected) => {
    expect(toTimestamp(value)).toBe(expected);
  });
});

describe("getValueKeys", () => {
  it("finds the numeric columns, also quoted or NULL in the first row", () => {
    const rows = [
      // ClickHouse returns NULL for the leading bucket of an aggregate with
      // no events yet.
      { time: "t0", count: "42", p99: null, service: "api", label: null },
      { time: "t1", count: "40", p99: 12.5, service: "db", label: "x" },
    ];
    expect(getValueKeys(rows, "time")).toEqual(["count", "p99"]);
  });
});

describe("niceLinearDomain", () => {
  it("ends on round steps rather than whatever the data happened to reach", () => {
    expect(niceLinearDomain(0, 87)).toEqual({
      domain: [0, 100],
      ticks: [0, 25, 50, 75, 100],
    });
    expect(niceLinearDomain(0, 1024)).toEqual({
      domain: [0, 1500],
      ticks: [0, 500, 1000, 1500],
    });
  });

  it("covers the data, so nothing plots outside the axis", () => {
    for (const max of [1, 3, 7, 9, 23, 45, 133, 999, 5000, 86400, 0.07]) {
      const { domain } = niceLinearDomain(0, max);
      expect(domain[1]).toBeGreaterThanOrEqual(max);
    }
  });

  it("uses the data range unless a bound is set", () => {
    const automatic = niceLinearDomain(900, 1000);
    expect(automatic.domain[0]).toBeGreaterThan(0);
    expect(automatic.domain[0]).toBeLessThan(900);
    expect(automatic.domain[1]).toBeGreaterThan(1000);
    expect(niceLinearDomain(900, 1000, 5, { min: 0 }).domain).toEqual([0, 1000]);
    expect(niceLinearDomain(900, 1000, 5, { max: 1200 }).domain[1]).toBe(1200);
    expect(niceLinearDomain(900, 1000, 5, { min: 925, max: 975 }).domain).toEqual([925, 975]);
  });

  it("extends below zero only when the data goes there", () => {
    const { domain, ticks } = niceLinearDomain(-12, 87);
    expect(domain[0]).toBeLessThanOrEqual(-12);
    expect(domain[1]).toBeGreaterThanOrEqual(87);
    expect(ticks[0]).toBe(domain[0]);
    expect(ticks.at(-1)).toBe(domain[1]);
  });

  it("gives a flat series an axis with height instead of plotting on the edge", () => {
    const { domain } = niceLinearDomain(0, 0);
    expect(domain[1]).toBeGreaterThan(domain[0]);
    expect(niceLinearDomain(0, 0).domain).toEqual([-1, 1]);
    const small = niceLinearDomain(0.001, 0.001).domain;
    expect(small[0]).toBeGreaterThan(0);
    expect(small[0]).toBeLessThan(0.001);
    expect(small[1]).toBeGreaterThan(0.001);
  });

  it("labels fractional ticks cleanly, without binary-addition dust", () => {
    // Adding a 0.2 step repeatedly reaches 0.6000000000000001, which an axis
    // would print verbatim.
    expect(niceLinearDomain(0, 1, 5, { min: 0 }).ticks).toEqual([0, 0.25, 0.5, 0.75, 1]);
  });

  it("terminates when a tick step is smaller than floating-point precision", () => {
    const min = 10_000_000_000_000_000;
    const max = min + 2;
    expect(niceLinearDomain(min, max, 5, { min, max })).toEqual({
      domain: [min, max],
      ticks: [min, max],
    });
  });

  it("survives data that carries no usable numbers", () => {
    const { domain } = niceLinearDomain(Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY);
    expect(domain.every(Number.isFinite)).toBe(true);
  });
});

describe("nearestSampleIndex", () => {
  it.each([
    ["between samples", [0, 100, 200, 300], 140, 1],
    ["past the last one", [0, 100, 200, 300], 900, 3],
    ["when there is only one", [500], 0, 0],
  ])("finds the sample %s", (_, samples, target, expected) => {
    expect(nearestSampleIndex(samples, target)).toBe(expected);
  });
});

describe("bucketIndexAt", () => {
  it.each([
    ["late in a bucket", 190, 1],
    ["at a bucket's start", 200, 2],
    ["inside the last bucket", 399, 3],
    ["past the last bucket", 400, null],
    ["before the first bucket", -1, null],
  ])("finds the bucket %s", (_, target, expected) => {
    expect(bucketIndexAt([0, 100, 200, 300], target)).toBe(expected);
  });
});
