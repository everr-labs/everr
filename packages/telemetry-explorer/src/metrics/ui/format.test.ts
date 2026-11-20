import { describe, expect, it } from "vite-plus/test";
import { unitName } from "./format";

describe("unitName", () => {
  it("spells out UCUM codes", () => {
    expect(unitName("By")).toBe("bytes");
    expect(unitName("s")).toBe("seconds");
    expect(unitName("1")).toBe("dimensionless");
  });

  it("drops the braces of an annotation", () => {
    expect(unitName("{request}")).toBe("request");
  });

  it("spells out each side of a rate", () => {
    expect(unitName("By/s")).toBe("bytes/s");
    expect(unitName("{packet}/s")).toBe("packet/s");
  });

  it("keeps codes it doesn't know", () => {
    expect(unitName("W")).toBe("W");
  });
});
