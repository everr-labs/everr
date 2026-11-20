import { describe, expect, it } from "vite-plus/test";
import {
  bucketLayout,
  bucketQuantile,
  exponentialBuckets,
  exponentialSpan,
  fitExponentialScale,
  rebucket,
} from "./histogram";

// One histogram on its own covers its own span.
const bucketsOf = (
  scale: number,
  positive: Record<string, number>,
  negative: Record<string, number>,
  zero: number,
) => exponentialBuckets(scale, positive, negative, zero, exponentialSpan([{ positive, negative }]));

// Buckets: [0, 0.1], (0.1, 0.5], (0.5, 1], and above 1.
const bounds = [0.1, 0.5, 1];

describe("bucketQuantile", () => {
  it("interpolates inside the bucket that holds the quantile", () => {
    expect(bucketQuantile(0.5, bounds, [0, 20, 0, 0])).toBeCloseTo(0.3);
    expect(bucketQuantile(0.95, bounds, [50, 40, 10, 0])).toBeCloseTo(0.75);
  });

  it("starts the first bucket at zero", () => {
    expect(bucketQuantile(0.5, bounds, [10, 0, 0, 0])).toBeCloseTo(0.05);
  });

  it("reports the last bound for a quantile above it", () => {
    expect(bucketQuantile(0.99, bounds, [1, 0, 0, 99])).toBe(1);
  });

  it("has no value without observations", () => {
    expect(bucketQuantile(0.5, bounds, [0, 0, 0, 0])).toBeNull();
  });
});

describe("bucketLayout", () => {
  it("keeps a single layout as is", () => {
    expect(bucketLayout([bounds, [...bounds]])).toEqual({ bounds, layouts: 1 });
  });

  it("uses the coarser bounds when every layout contains them", () => {
    expect(bucketLayout([bounds, [0.1, 0.25, 0.5, 0.75, 1]])).toEqual({
      bounds,
      merge: "shared",
      layouts: 2,
    });
  });

  it("uses every bound when the shared ones stop below a finer layout's range", () => {
    expect(bucketLayout([bounds, [0.1, 0.5, 1, 2.5]])).toEqual({
      bounds: [0.1, 0.5, 1, 2.5],
      merge: "interpolated",
      layouts: 2,
    });
  });

  it("uses every bound when the layouts don't nest", () => {
    expect(bucketLayout([bounds, [0.05, 0.25, 1]])).toEqual({
      bounds: [0.05, 0.1, 0.25, 0.5, 1],
      merge: "interpolated",
      layouts: 2,
    });
  });
});

describe("rebucket", () => {
  it("merges whole buckets onto bounds they contain", () => {
    expect(rebucket([0.1, 0.25, 0.5, 1, 2.5], [1, 2, 3, 4, 5, 6], bounds)).toEqual([1, 5, 4, 11]);
  });

  it("splits a bucket over the bounds inside it by width", () => {
    // (0.25, 0.75] halves at 0.5; above 0.75 lands just above it.
    expect(rebucket([0.25, 0.75], [10, 20, 4], [0.25, 0.5, 0.75, 1])).toEqual([10, 10, 10, 4, 0]);
  });

  it("keeps buckets below a first bound at or under zero", () => {
    expect(rebucket([-10, -5, 5, 10], [0, 10, 0, 0, 0], [-5, 5, 10])).toEqual([10, 0, 0, 0]);
  });
});

describe("exponentialBuckets", () => {
  it("turns positive bucket indexes into bounds at the scale's base", () => {
    // Scale 0: base 2, bucket 1 holds (2, 4], bucket 3 holds (8, 16].
    expect(bucketsOf(0, { "1": 5, "3": 2 }, {}, 1)).toEqual({
      bounds: [0, 2, 4, 8, 16],
      counts: [1, 0, 5, 0, 2, 0],
    });
  });

  it("mirrors negative buckets below zero", () => {
    // Scale 1: base √2, negative bucket 0 holds [-√2, -1).
    const { bounds, counts } = bucketsOf(1, {}, { "0": 3 }, 0);
    expect(bounds.map((b) => +b.toFixed(4))).toEqual([-1.4142, -1, 0, 0]);
    expect(counts).toEqual([0, 3, 0, 0, 0]);
  });

  it("keeps zeros at zero when there are negative values", () => {
    // One value near -1.5, ten zeros and one near 1.5: the median is zero.
    const { bounds, counts } = bucketsOf(0, { "0": 1 }, { "0": 1 }, 10);
    expect(bucketQuantile(0.5, bounds, counts)).toBe(0);
  });

  it("gives percentiles inside the bucket that holds them", () => {
    const { bounds, counts } = bucketsOf(0, { "1": 10 }, {}, 0);
    expect(bucketQuantile(0.5, bounds, counts)).toBeCloseTo(3);
  });
});

describe("fitExponentialScale", () => {
  it("lowers the scale until the span fits", () => {
    // Indexes 0 and 1000 at one scale would expand to 1001 buckets.
    const { shift, histograms } = fitExponentialScale([
      { positive: { "0": 1, "1000": 1 }, negative: {} },
    ]);
    expect(shift).toBe(3);
    expect(histograms[0]?.positive).toEqual({ "0": 1, "125": 1 });
  });

  it("adds up buckets that merge at the lower scale", () => {
    const { histograms } = fitExponentialScale([{ positive: { "2": 1, "3": 2 }, negative: {} }], 1);
    expect(histograms[0]?.positive).toEqual({ "1": 3 });
  });

  it("leaves a narrow span as it is", () => {
    expect(fitExponentialScale([{ positive: { "1": 1, "5": 1 }, negative: {} }]).shift).toBe(0);
  });
});
