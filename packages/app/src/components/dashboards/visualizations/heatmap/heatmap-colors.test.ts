import { describe, expect, it } from "vite-plus/test";
import {
  HEATMAP_COLOR_SCHEMES,
  heatmapColor,
  heatmapColorRgb,
  isDarkColor,
} from "./heatmap-colors";

describe("heatmapColorRgb", () => {
  it("returns the first stop at t=0 and the last at t=1", () => {
    expect(heatmapColorRgb("spectral", 0)).toEqual([69, 117, 180]);
    expect(heatmapColorRgb("spectral", 1)).toEqual([215, 48, 39]);
  });

  it("interpolates linearly between adjacent stops", () => {
    // blues: midpoint of a 3-stop ramp lands exactly on the middle stop
    expect(heatmapColorRgb("blues", 0.5)).toEqual([59, 130, 246]);
  });

  it("clamps t outside [0,1]", () => {
    expect(heatmapColorRgb("reds", -1)).toEqual(heatmapColorRgb("reds", 0));
    expect(heatmapColorRgb("reds", 2)).toEqual(heatmapColorRgb("reds", 1));
  });

  it("every scheme produces opaque rgb colors across the ramp", () => {
    for (const scheme of HEATMAP_COLOR_SCHEMES) {
      for (const t of [0, 0.3, 0.7, 1]) {
        expect(heatmapColor(scheme, t)).toMatch(/^rgb\(\d+, \d+, \d+\)$/);
      }
    }
  });
});

describe("isDarkColor", () => {
  it("flags dark ramp ends and not light ones", () => {
    expect(isDarkColor(heatmapColorRgb("blues", 1))).toBe(true);
    expect(isDarkColor(heatmapColorRgb("blues", 0))).toBe(false);
  });
});
