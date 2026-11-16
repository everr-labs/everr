import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import { isNumericValue } from "#app/lib/numeric.ts";
import {
  detectTimeKey,
  generateTimeTicks,
  getValueKeys,
  nearestSampleIndex,
  bucketIndexAt,
  samplingStep,
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
    ["a DateTime64 with milliseconds", "2026-06-07 00:00:00.250", utc + 250],
    [
      "a DateTime64 with nanoseconds, to the millisecond",
      "2026-06-07 00:00:00.250999999",
      utc + 250,
    ],
    ["a DateTime with one digit of fraction", "2026-06-07 00:00:00.5", utc + 500],
    ["a DateTime with spaces around it", " 2026-06-07 00:00:00 ", utc],
    ["a month the calendar does not have", "2026-13-07 00:00:00", null],
    ["an hour the clock does not have", "2026-06-07 25:00:00", null],
    ["a DateTime with letters for digits", "2026-06-07 0a:00:00", null],
    ["a DateTime with a fraction that is no number", "2026-06-07 00:00:00.x", null],
  ])("reads %s", (_, value, expected) => {
    expect(toTimestamp(value)).toBe(expected);
  });

  it("reads every ClickHouse DateTime as the Date parser does", () => {
    const pad = (value: number, length = 2) => String(value).padStart(length, "0");
    // Across leap days, month ends and every length of fraction.
    for (let i = 0; i < 4_000; i++) {
      const day = new Date(Date.UTC(2023, 11, 25) + i * 37_000_123);
      const date = `${day.getUTCFullYear()}-${pad(day.getUTCMonth() + 1)}-${pad(day.getUTCDate())}`;
      const time = `${pad(day.getUTCHours())}:${pad(day.getUTCMinutes())}:${pad(day.getUTCSeconds())}`;
      const fraction =
        i % 10 === 0 ? "" : `.${pad(day.getUTCMilliseconds(), 3)}456789`.slice(0, 1 + (i % 10));
      const text = `${date} ${time}${fraction}`;
      expect(toTimestamp(text), text).toBe(Date.parse(`${date}T${time}${fraction}Z`));
    }
  });

  it.each([
    "2026-02-30 00:00:00",
    "2026-04-31 12:00:00",
    "2026-02-29 00:00:00",
    "2024-02-29 00:00:00",
  ])("leaves %s, a day not in every month, to the Date parser", (text) => {
    const parsed = Date.parse(`${text.replace(" ", "T")}Z`);
    expect(toTimestamp(text)).toBe(Number.isNaN(parsed) ? null : parsed);
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
    ["before the first one", [0, 100, 200, 300], -50, 0],
    ["exactly on one", [0, 100, 200, 300], 200, 2],
    ["earlier of two as near", [0, 100, 200, 300], 150, 1],
    ["when there is only one", [500], 0, 0],
  ])("finds the sample %s", (_, samples, target, expected) => {
    expect(nearestSampleIndex(samples, target)).toBe(expected);
  });

  it("finds none when there are no samples", () => {
    expect(nearestSampleIndex([], 100)).toBeNull();
  });

  it("agrees with a walk over every sample", () => {
    // Uneven steps, so a guess at the position from the spacing would miss.
    let time = 0;
    const samples = Array.from({ length: 2_000 }, (_, i) => {
      time += 1 + (i % 5) * 3;
      return time;
    });
    for (let target = -20; target < 14_100; target += 13) {
      let nearest = 0;
      samples.forEach((sample, index) => {
        if (Math.abs(sample - target) < Math.abs((samples[nearest] ?? 0) - target)) nearest = index;
      });
      expect(nearestSampleIndex(samples, target)).toBe(nearest);
    }
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
    expect(bucketIndexAt([0, 100, 200, 300], 100, target)).toBe(expected);
  });

  it("finds no bucket in one the query skipped", () => {
    // Hourly buckets with 03:00 to 08:00 empty.
    expect(bucketIndexAt([0, 100, 200, 900], 100, 500)).toBeNull();
    expect(bucketIndexAt([0, 100, 200, 900], 100, 950)).toBe(3);
  });
});

describe("samplingStep", () => {
  it.each([
    ["regular samples", [[0, 60, 120, 180]], 60],
    ["samples with a skipped bucket", [[0, 60, 120, 600, 660]], 60],
    [
      "series sampled at offset times",
      [
        [0, 60, 120],
        [1, 61, 121],
      ],
      60,
    ],
    ["lone samples", [[0], [5]], 0],
  ])("reads %s", (_, series, expected) => {
    expect(samplingStep(series)).toBe(expected);
  });
});

describe("generateTimeTicks", () => {
  // US clocks fall back on Nov 1, 2026.
  const zone = process.env.TZ;
  beforeAll(() => {
    process.env.TZ = "America/New_York";
  });
  afterAll(() => {
    // Assigning undefined would set the string "undefined".
    if (zone === undefined) delete process.env.TZ;
    else process.env.TZ = zone;
  });

  it.each([
    ["days on local midnight", "2026-10-29T12:00:00-04:00", "2026-11-05T12:00:00-05:00"],
    ["hours on whole local hours", "2026-11-01T00:00:00-04:00", "2026-11-01T12:00:00-05:00"],
  ])("steps %s across a DST change", (_, from, to) => {
    const ticks = generateTimeTicks([Date.parse(from), Date.parse(to)], 6);
    const local = ticks.map((tick) => new Date(tick));
    expect(ticks.length).toBeGreaterThanOrEqual(3);
    expect(local.every((at) => at.getMinutes() === 0)).toBe(true);
    const hours = new Set(local.map((at) => at.getHours() % 3));
    expect(hours).toEqual(new Set([0]));
  });

  it("falls a whole number of buckets apart over buckets that allow it", () => {
    const hour = 3_600_000;
    const start = new Date(2026, 5, 8, 1).getTime();
    const ticks = generateTimeTicks([start, start + 24 * hour], 6, 4 * hour);
    expect(ticks.length).toBeGreaterThanOrEqual(2);
    expect(ticks.every((tick) => (tick - ticks[0]!) % (4 * hour) === 0)).toBe(true);
  });
});
