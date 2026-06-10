import { describe, expect, it } from "vitest";
import type { QueryResultRow } from "../index";
import {
  colorRamp,
  deriveDomain,
  extractMarkers,
  markerRadius,
  mergeRegions,
  schemeBaseColor,
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
      [{ region: "usa", value: 2 }, { region: "DE", value: 7 }],
    ];
    const { values, unmatched } = mergeRegions(frames, spec({ mode: "choropleth" }));
    expect(values.get("840")).toBe(5);
    expect(values.get("276")).toBe(7);
    expect(unmatched).toBe(0);
  });

  it("counts rows whose region code is unknown", () => {
    const frames = [[{ region: "ZZ", value: 1 }]];
    const { values, unmatched } = mergeRegions(frames, spec({ mode: "choropleth" }));
    expect(values.size).toBe(0);
    expect(unmatched).toBe(1);
  });
});

describe("deriveDomain", () => {
  it("uses data min/max when spec leaves them unset", () => {
    expect(deriveDomain([3, 1, 9, 4], spec())).toEqual([1, 9]);
  });

  it("prefers explicit spec min/max", () => {
    expect(deriveDomain([3, 1, 9], spec({ min: 0, max: 100 }))).toEqual([0, 100]);
  });

  it("falls back to [0,1] for an empty set", () => {
    expect(deriveDomain([], spec())).toEqual([0, 1]);
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
});

describe("colorRamp + schemeBaseColor", () => {
  it("returns the light end at t=0 and the dark end at t=1", () => {
    expect(colorRamp("blue", 0)).toBe("rgb(219, 234, 254)");
    expect(colorRamp("blue", 1)).toBe("rgb(30, 64, 175)");
  });

  it("interpolates channel-wise at t=0.5", () => {
    expect(colorRamp("blue", 0.5)).toBe("rgb(125, 149, 215)");
  });

  it("schemeBaseColor returns the dark end", () => {
    expect(schemeBaseColor("green")).toBe("rgb(22, 101, 52)");
  });
});
