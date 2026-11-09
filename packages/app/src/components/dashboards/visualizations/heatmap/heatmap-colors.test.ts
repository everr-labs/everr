import { describe, expect, it } from "vite-plus/test";
import { heatmapColorRgb } from "./heatmap-colors";

describe("heatmapColorRgb", () => {
  it("interpolates between the stops, clamping t to 0..1", () => {
    expect(heatmapColorRgb("spectral", 0)).toEqual([69, 117, 180]);
    expect(heatmapColorRgb("spectral", 1)).toEqual([215, 48, 39]);
    // The midpoint of a 3-stop ramp lands on the middle stop.
    expect(heatmapColorRgb("blues", 0.5)).toEqual([59, 130, 246]);
    expect(heatmapColorRgb("reds", -1)).toEqual(heatmapColorRgb("reds", 0));
    expect(heatmapColorRgb("reds", 2)).toEqual(heatmapColorRgb("reds", 1));
  });
});
