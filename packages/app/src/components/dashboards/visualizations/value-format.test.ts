import { describe, expect, it } from "vitest";
import {
  formatCompactValue,
  formatValue,
  formatValueParts,
} from "./value-format";

describe("formatValue", () => {
  it("auto-scales raw bytes with binary units", () => {
    const options = { displayUnit: "auto" as const };
    expect(formatValue(0, "By", options)).toBe("0 B");
    expect(formatValue(1023, "By", options)).toBe(
      `${(1023).toLocaleString()} B`,
    );
    expect(formatValue(1024, "By", options)).toBe("1 KiB");
    expect(formatValue(1.5 * 1024 ** 2, "By", options)).toBe("1.5 MiB");
    expect(formatValue(2.25 * 1024 ** 3, "By", options)).toBe("2.25 GiB");
    expect(formatValue(-3 * 1024 ** 4, "By", options)).toBe("-3 TiB");
  });

  it("normalizes pre-scaled byte query results before choosing a display unit", () => {
    expect(formatValue(1.5, "GiBy", { displayUnit: "auto" })).toBe("1.5 GiB");
    expect(formatValue(1.5, "GiB", { displayUnit: "auto" })).toBe("1.5 GiB");
    expect(formatValue(1536, "MiB", { displayUnit: "auto" })).toBe("1.5 GiB");
    expect(formatValue(1500, "MB", { displayUnit: "auto" })).toBe("1.5 GB");
  });

  it("auto-scales duration query results", () => {
    expect(formatValue(1500, "ms", { displayUnit: "auto" })).toBe("1.5 s");
    expect(formatValue(0.5, "ms", { displayUnit: "auto" })).toBe("500 µs");
    expect(formatValue(90, "s", { displayUnit: "auto" })).toBe("1.5 min");
  });

  it("honors fixed decimals while auto-scaling", () => {
    expect(
      formatValue(1.5 * 1024 ** 3, "By", {
        decimals: 2,
        displayUnit: "auto",
      }),
    ).toBe(
      `${(1.5).toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })} GiB`,
    );
  });

  it("preserves literal units", () => {
    expect(formatValue(1234, "ms", { locale: false })).toBe("1234ms");
    expect(formatValue(1234, "req")).toBe(`${(1234).toLocaleString()}req`);
    expect(formatValue(1.5, "GiBy")).toBe("1.5GiBy");
    expect(formatValue(1234, "req", { displayUnit: "auto" })).toBe(
      `${(1234).toLocaleString()}req`,
    );
  });

  it("returns semantic value and unit separately for stat tiles", () => {
    expect(
      formatValueParts(5 * 1024 ** 3, "By", { displayUnit: "auto" }),
    ).toEqual({
      value: "5",
      unit: "GiB",
    });
  });
});

describe("formatCompactValue", () => {
  it("keeps the existing decimal magnitude abbreviations", () => {
    expect(formatCompactValue(2_500_000_000)).toBe(
      `${(2.5).toLocaleString()}B`,
    );
  });
});
