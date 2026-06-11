import { describe, expect, it } from "vitest";
import { colorRamp, normalizeValue, schemeBaseColor } from "../color-scale";
import type { QueryResultRow } from "../index";
import {
  deriveDomain,
  extractMarkers,
  markerRadius,
  mergeRegions,
} from "./geo-data";
import { geoMapSpec } from "./spec";

const spec = (o: Record<string, unknown> = {}) => geoMapSpec.parse(o);

describe("extractMarkers", () => {
  it("reads lat/lon/value across all frames and tags each with its frame index", () => {
    const frames = [
      [{ lat: 10, lon: 20, value: 5 }],
      [{ lat: -5, lon: 30, value: 8 }],
    ];
    const { markers, skipped } = extractMarkers(frames, spec());
    expect(skipped).toBe(0);
    expect(markers).toEqual([
      { lat: 10, lon: 20, value: 5, frame: 0, label: undefined },
      { lat: -5, lon: 30, value: 8, frame: 1, label: undefined },
    ]);
  });

  it("skips rows with missing or out-of-range coordinates", () => {
    const frames = [
      [
        { lat: 10, lon: 20, value: 1 },
        { lat: 999, lon: 0, value: 1 },
        { lat: 0, lon: "x", value: 1 },
        { lon: 5, value: 1 },
      ],
    ] as unknown as QueryResultRow[][];
    const { markers, skipped } = extractMarkers(frames, spec());
    expect(markers).toHaveLength(1);
    expect(skipped).toBe(3);
  });

  it("uses labelColumn for the marker label when set", () => {
    const frames = [[{ lat: 1, lon: 2, value: 3, city: "Berlin" }]];
    const { markers } = extractMarkers(frames, spec({ labelColumn: "city" }));
    expect(markers[0]?.label).toBe("Berlin");
  });
});

describe("mergeRegions", () => {
  it("maps region codes to numeric ids and sums values across frames", () => {
    const frames = [
      [{ region: "US", value: 3 }],
      [
        { region: "usa", value: 2 },
        { region: "DE", value: 7 },
      ],
    ];
    const { values, unmatched } = mergeRegions(
      frames,
      spec({ mode: "choropleth" }),
    );
    expect(values.get("840")).toBe(5);
    expect(values.get("276")).toBe(7);
    expect(unmatched).toBe(0);
  });

  it("combines same-region rows with the configured aggregation", () => {
    const frames = [
      [
        { region: "US", value: 2 },
        { region: "US", value: 8 },
        { region: "US", value: 5 },
      ],
    ];
    const get = (aggregation: string) =>
      mergeRegions(
        frames,
        spec({ mode: "choropleth", aggregation }),
      ).values.get("840");
    expect(get("sum")).toBe(15);
    expect(get("avg")).toBe(5);
    expect(get("min")).toBe(2);
    expect(get("max")).toBe(8);
    expect(get("last")).toBe(5);
  });

  it("counts rows whose region code is unknown", () => {
    const frames = [[{ region: "ZZ", value: 1 }]];
    const { values, unmatched } = mergeRegions(
      frames,
      spec({ mode: "choropleth" }),
    );
    expect(values.size).toBe(0);
    expect(unmatched).toBe(1);
  });
});

describe("deriveDomain", () => {
  it("uses data min/max when spec leaves them unset", () => {
    expect(deriveDomain([3, 1, 9, 4], spec())).toEqual([1, 9]);
  });

  it("prefers explicit spec min/max", () => {
    expect(deriveDomain([3, 1, 9], spec({ min: 0, max: 100 }))).toEqual([
      0, 100,
    ]);
  });

  it("falls back to [0,1] for an empty set", () => {
    expect(deriveDomain([], spec())).toEqual([0, 1]);
  });

  it("zeroFloor extends an all-positive extent down to 0", () => {
    expect(deriveDomain([3, 9], spec(), { zeroFloor: true })).toEqual([0, 9]);
    // explicit spec.min wins over the floor
    expect(deriveDomain([3, 9], spec({ min: 2 }), { zeroFloor: true })).toEqual(
      [2, 9],
    );
    // negative extents are kept as-is
    expect(deriveDomain([-4, 9], spec(), { zeroFloor: true })).toEqual([-4, 9]);
  });

  it("handles large value sets without spreading onto the stack", () => {
    const vals = Array.from({ length: 300_000 }, (_, i) => i % 1000);
    expect(deriveDomain(vals, spec())).toEqual([0, 999]);
  });
});

describe("normalizeValue", () => {
  it("is linear by default, clamped to [0,1]", () => {
    expect(normalizeValue(5, [0, 10])).toBe(0.5);
    expect(normalizeValue(-1, [0, 10])).toBe(0);
    expect(normalizeValue(11, [0, 10])).toBe(1);
  });

  it("sqrt boosts mid-range values (area-proportional markers)", () => {
    expect(normalizeValue(25, [0, 100], "sqrt")).toBe(0.5);
    expect(normalizeValue(0, [0, 100], "sqrt")).toBe(0);
    expect(normalizeValue(100, [0, 100], "sqrt")).toBe(1);
  });

  it("log spreads decades evenly over a positive domain", () => {
    expect(normalizeValue(10, [1, 1000], "log")).toBeCloseTo(1 / 3);
    expect(normalizeValue(100, [1, 1000], "log")).toBeCloseTo(2 / 3);
    expect(normalizeValue(1, [1, 1000], "log")).toBe(0);
    expect(normalizeValue(1000, [1, 1000], "log")).toBe(1);
  });

  it("log with a non-positive min spans the top three decades below max", () => {
    // lo becomes 1000/1000 = 1
    expect(normalizeValue(1, [0, 1000], "log")).toBe(0);
    expect(normalizeValue(0, [0, 1000], "log")).toBe(0);
    expect(normalizeValue(1000, [0, 1000], "log")).toBe(1);
  });

  it("log handles degenerate domains without NaN", () => {
    expect(normalizeValue(5, [5, 5], "log")).toBe(1);
    expect(normalizeValue(-1, [-10, 0], "log")).toBe(0);
  });
});

describe("markerRadius", () => {
  it("maps the domain onto the radius range", () => {
    expect(markerRadius(0, [0, 10], [2, 12])).toBe(2);
    expect(markerRadius(10, [0, 10], [2, 12])).toBe(12);
    expect(markerRadius(5, [0, 10], [2, 12])).toBe(7);
  });

  it("clamps out-of-domain values and handles a degenerate domain", () => {
    expect(markerRadius(99, [0, 10], [2, 12])).toBe(12);
    expect(markerRadius(5, [5, 5], [2, 12])).toBe(2);
  });

  it("applies the scale curve to the radius", () => {
    expect(markerRadius(25, [0, 100], [0, 10], "sqrt")).toBe(5);
    expect(markerRadius(10, [1, 1000], [0, 9], "log")).toBeCloseTo(3);
  });
});

describe("colorRamp + schemeBaseColor", () => {
  it("fades from transparent at t=0 to full color at t=1", () => {
    expect(colorRamp("blue", 0)).toBe("rgba(37, 99, 235, 0)");
    expect(colorRamp("blue", 1)).toBe("rgba(37, 99, 235, 1)");
  });

  it("scales opacity with t", () => {
    expect(colorRamp("blue", 0.5)).toBe("rgba(37, 99, 235, 0.5)");
  });

  it("clamps t outside [0,1]", () => {
    expect(colorRamp("blue", -1)).toBe("rgba(37, 99, 235, 0)");
    expect(colorRamp("blue", 2)).toBe("rgba(37, 99, 235, 1)");
  });

  it("schemeBaseColor returns the full color", () => {
    expect(schemeBaseColor("green")).toBe("rgb(22, 163, 74)");
  });
});
