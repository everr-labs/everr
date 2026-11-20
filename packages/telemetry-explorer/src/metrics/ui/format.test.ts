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
});
