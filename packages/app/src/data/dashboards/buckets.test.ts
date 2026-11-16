import { describe, expect, it } from "vite-plus/test";
import { bucketsForWidth, bucketWidthSeconds, usesBucketsParam } from "./buckets";

describe("bucketsForWidth", () => {
  it.each([
    [0, 100],
    [-5, 100],
    [100, 100],
    [101, 200],
    [301, 400],
    [640, 700],
    [1000, 1000],
    [5000, 1000],
  ])("sizes a %ipx panel to %i buckets", (width, expected) => {
    expect(bucketsForWidth(width)).toBe(expected);
  });
});

describe("usesBucketsParam", () => {
  it.each(["{buckets:UInt32}", "{ buckets : UInt32 }"])("is true for %s", (token) => {
    expect(usesBucketsParam(`SELECT intDiv(1, ${token})`)).toBe(true);
  });

  it("is false for another parameter", () => {
    expect(usesBucketsParam("SELECT {step:UInt32}")).toBe(false);
  });

  it("is false for the bare word", () => {
    expect(usesBucketsParam("SELECT 1 AS buckets")).toBe(false);
  });
});

describe("bucketWidthSeconds", () => {
  const from = new Date("2026-06-10T00:00:00Z");

  it("divides the range by the bucket count", () => {
    expect(bucketWidthSeconds(from, new Date("2026-06-10T01:00:00Z"), 400)).toBe(9);
  });

  it("never drops below one second", () => {
    expect(bucketWidthSeconds(from, new Date("2026-06-10T00:00:10Z"), 1000)).toBe(1);
  });
});
