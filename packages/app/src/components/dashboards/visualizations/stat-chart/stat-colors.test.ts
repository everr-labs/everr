import { describe, expect, it } from "vitest";
import { SERIES_COLORS } from "../data-utils";
import { resolveStatSparklineColor } from "./stat-colors";

describe("resolveStatSparklineColor", () => {
  it("keeps the shared accent color when no series override is configured", () => {
    expect(resolveStatSparklineColor("Logs", {}, undefined, false)).toBe(
      SERIES_COLORS[0],
    );
  });

  it("uses the color configured for the series label", () => {
    expect(
      resolveStatSparklineColor(
        "Traces",
        { Traces: "#fde047" },
        undefined,
        false,
      ),
    ).toBe("#fde047");
  });

  it("keeps threshold and filled-background colors ahead of series overrides", () => {
    const colors = { Metrics: "#22d3ee" };
    expect(resolveStatSparklineColor("Metrics", colors, "#ef4444", false)).toBe(
      "#ef4444",
    );
    expect(resolveStatSparklineColor("Metrics", colors, "#ef4444", true)).toBe(
      "rgba(255, 255, 255, 0.9)",
    );
  });
});
