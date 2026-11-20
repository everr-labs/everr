import { describe, expect, it } from "vite-plus/test";
import { formatMetricValue, unitName } from "./format";

describe("unitName", () => {
  it("spells out UCUM codes", () => {
    expect(unitName("By")).toBe("bytes");
    expect(unitName("s")).toBe("seconds");
    expect(unitName("1")).toBe("dimensionless");
  });

  it("drops the braces of an annotation", () => {
    expect(unitName("{request}")).toBe("request");
  });

  it("spells out the unit of a rate, keeping its time short", () => {
    expect(unitName("By/s")).toBe("bytes/s");
    expect(unitName("{packet}/s")).toBe("packet/s");
  });

  it("keeps codes it doesn't know", () => {
    expect(unitName("W")).toBe("W");
  });
});

describe("formatMetricValue", () => {
  it("scales durations to a readable unit, up to days", () => {
    expect(formatMetricValue(0.25, "s")).toBe("250 ms");
    expect(formatMetricValue(90, "min")).toBe("1.5 h");
    expect(formatMetricValue(36, "h")).toBe("1.5 d");
  });

  it("moves up a unit when rounding reaches it", () => {
    expect(formatMetricValue(0.9996, "s")).toBe("1 s");
    expect(formatMetricValue(59.99, "min")).toBe("1 h");
    expect(formatMetricValue(59.96, "s")).toBe("1 min");
  });

  it("scales every byte unit, and the numerator of a unit per second", () => {
    expect(formatMetricValue(1536, "KiBy")).toBe("1.5 MiB");
    expect(formatMetricValue(3.5 * 1024 ** 2, "By/s")).toBe("3.5 MiB/s");
    expect(formatMetricValue(12, "{request}/s")).toBe("12/s");
    expect(formatMetricValue(21.5, "Cel")).toBe("21.5 °C");
  });

  it("shows more significant digits when asked", () => {
    expect(formatMetricValue(1.001, "ms")).toBe("1 ms");
    expect(formatMetricValue(1.001, "ms", undefined, 4)).toBe("1.001 ms");
  });
});
