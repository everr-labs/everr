import { describe, expect, it } from "vitest";
import { createValueFormatter } from "./value-format";
import { valueFormatSpec } from "./value-format-spec";

const formatter = (
  unit: string,
  scale: "none" | "decimal" | "binary" | "duration",
  decimals?: number,
) => createValueFormatter({ unit, scale, decimals });

describe("value formatting", () => {
  it.each([
    [3.2e9, "Hz", "3.2 GHz"],
    [1500, "W", "1.5 kW"],
    [2.5e6, "J", "2.5 MJ"],
    [12000, "V", "12 kV"],
    [-2500, "A", "-2.5 kA"],
    [0, "Hz", "0 Hz"],
    [0.25, "A", "0.25 A"],
  ] as const)("places SI prefixes on %s %s", (value, unit, expected) => {
    const result = formatter(unit, "decimal");
    expect(result.format(value)).toBe(expected);
    expect(result.axis(Math.abs(value))(value)).toBe(expected);
  });

  it("keeps SI axis prefixes stable without reinterpreting input prefixes or custom labels", () => {
    const axis = formatter("Hz", "decimal").axis(4e9);
    expect([0, 1e9, -2e9].map(axis)).toEqual(["0 GHz", "1 GHz", "-2 GHz"]);
    expect(formatter("Hz", "decimal", 2).parts(3.2e9)).toEqual({
      value: "3.20",
      unit: "GHz",
      separator: " ",
    });
    expect(formatter("GHz", "none").format(3.2)).toBe("3.2 GHz");
    expect(formatter("widgets", "decimal").format(1500)).toBe("1.5k widgets");
    expect(formatter("Hz", "binary").format(2048)).toBe("2Ki Hz");
  });

  it.each([
    [0, "0%"],
    [0.75, "75%"],
    [1, "100%"],
    [-0.125, "-12.5%"],
    [1.25, "125%"],
    [0.123456, "12.35%"],
    [Infinity, "∞%"],
    [NaN, "NaN%"],
  ])("explicitly displays the ratio %s as a percentage", (value, expected) => {
    const result = createValueFormatter(
      valueFormatSpec.parse({ unit: "1", display: "percent" }),
    );
    expect(result.format(value)).toBe(expected);
    expect(result.axis(1)(value)).toBe(expected);
  });

  it("keeps percentage precision explicit and leaves ordinary ratios and percentages unchanged", () => {
    const result = createValueFormatter(
      valueFormatSpec.parse({ unit: "1", display: "percent", decimals: 2 }),
    );
    expect(result.parts(0.75)).toEqual({
      value: "75.00",
      unit: "%",
      separator: "",
    });
    expect(formatter("1", "none").format(0.75)).toBe("0.75");
    expect(formatter("%", "none").format(0.75)).toBe("0.75%");
    expect(
      createValueFormatter(
        valueFormatSpec.parse({ unit: "1", display: "value" }),
      ).format(0.75),
    ).toBe("0.75");
  });

  it.each([
    { unit: "By", display: "percent" },
    { unit: "%", display: "percent" },
    { display: "percent" },
    { unit: "1", display: "percent", scale: "decimal" },
    { unit: "1", display: "percent", scale: "binary" },
    { unit: "1", display: "unknown" },
  ])("rejects incompatible percentage options %o", (spec) => {
    expect(valueFormatSpec.safeParse(spec).success).toBe(false);
  });
  it("uses the same default precision without format options", () => {
    const defaults = createValueFormatter();
    expect(defaults.format(42.56789)).toBe("42.57");
    expect(defaults.format(42)).toBe("42");
    expect(defaults.axis(100)(42.56789)).toBe("42.57");
  });
  it.each([
    [12500, "requests/s", "decimal", "12.5k requests/s"],
    [3500, "widgets/s", "decimal", "3.5k widgets/s"],
    [4200000, "tokens/min", "decimal", "4.2M tokens/min"],
    [1e9, "events", "decimal", "1G events"],
    [1536, "By", "binary", "1.5 KiB"],
    [2621440, "By/s", "binary", "2.5 MiB/s"],
    [-3072, "By/s", "binary", "-3 KiB/s"],
    [99.9, "%", "none", "99.9%"],
    [12500, "", "decimal", "12.5k"],
    [0, "widgets/s", "decimal", "0 widgets/s"],
    [0.25, "widgets", "decimal", "0.25 widgets"],
    [1023, "By", "binary", "1,023 B"],
    [1024, "By", "binary", "1 KiB"],
  ] as const)("formats %s with %s/%s", (value, unit, scale, expected) => {
    expect(formatter(unit, scale).format(value)).toBe(expected);
  });

  it.each([
    [0.025, "s", "25 ms"],
    [1.5, "s", "1.5 s"],
    [90, "s", "1.5 min"],
    [0.25, "ms", "250 µs"],
    [1500, "ms", "1.5 s"],
    [90000, "ms", "1.5 min"],
    [1500000, "ns", "1.5 ms"],
    [1500, "us", "1.5 ms"],
    [90, "min", "1.5 h"],
    [48, "h", "2 d"],
    [0.5, "d", "12 h"],
    [-90, "s", "-1.5 min"],
    [0, "s", "0 s"],
  ])("scales duration %s %s", (value, unit, expected) => {
    expect(formatter(String(unit), "duration").format(Number(value))).toBe(
      expected,
    );
  });

  it("can keep durations in decimal time steps", () => {
    expect(formatter("ms", "decimal").format(90000)).toBe("90 s");
    expect(formatter("s", "decimal").format(0.025)).toBe("25 ms");
  });

  it.each([
    [1536, "By", "none", "1,536 B"],
    [1.5, "MiBy", "none", "1.5 MiB"],
    [2.5, "GiBy/s", "none", "2.5 GiB/s"],
    [3, "MBy", "none", "3 MB"],
    [2500000, "By/s", "decimal", "2.5 MB/s"],
    [2500000, "bit/s", "decimal", "2.5 Mbit/s"],
    [21.234, "Cel", "none", "21.23 °C"],
    [25, "us", "none", "25 µs"],
    [0, "us", "duration", "0 µs"],
    [0.5, "1", "none", "0.5"],
    [12500, "1", "decimal", "12.5k"],
    [12500, "{request}", "decimal", "12.5k request"],
    [12500, "{request}/s", "decimal", "12.5k request/s"],
    [42, "{connection}", "none", "42 connection"],
    [42, "1/s", "none", "42 1/s"],
    [42, "B", "none", "42 B"],
    [2048, "B", "binary", "2Ki B"],
    [42, "unmapped/unit", "none", "42 unmapped/unit"],
    [42, "{unclosed", "none", "42 {unclosed"],
  ] as const)("presents UCUM code %s %s (%s)", (value, unit, scale, expected) => {
    const result = formatter(unit, scale);
    expect(result.format(value)).toBe(expected);
    expect(result.axis(value)(value)).toBe(expected.replace("1,536", "1536"));
  });

  it("keeps UCUM codes in the spec and maps non-finite unit labels", () => {
    expect(valueFormatSpec.parse({ unit: "By" }).unit).toBe("By");
    expect(formatter("Cel", "none").parts(21)).toEqual({
      value: "21",
      unit: "°C",
      separator: " ",
    });
    expect(formatter("By", "binary").format(NaN)).toBe("NaN B");
    expect(formatter("1", "none").format(Infinity)).toBe("∞");
    expect(
      valueFormatSpec.safeParse({ unit: "µs", scale: "duration" }).success,
    ).toBe(false);
  });

  it("preserves unscaled input units and explicit precision", () => {
    expect(formatter("s", "none", 3).format(0.025)).toBe("0.025 s");
    expect(formatter("%", "none", 2).format(2.3)).toBe("2.30%");
    expect(formatter("By", "binary", 2).format(1536)).toBe("1.50 KiB");
    expect(formatter("connections", "none", 0).format(8200)).toBe(
      "8,200 connections",
    );
  });

  it("fixes axis scales across zero, negative and small ticks", () => {
    const bytes = formatter("By", "binary");
    const axis = bytes.axis(2 * 1024 ** 2);
    expect([0, 1024 ** 2 / 2, 1024 ** 2, -(1024 ** 2)].map(axis)).toEqual([
      "0 MiB",
      "0.5 MiB",
      "1 MiB",
      "-1 MiB",
    ]);
    expect(bytes.format(1024)).toBe("1 KiB");
    expect(formatter("s", "duration").axis(90)(30)).toBe("0.5 min");
  });

  it("returns separate number and unit parts for tiles", () => {
    expect(formatter("By", "binary").parts(5 * 1024 ** 3)).toEqual({
      value: "5",
      unit: "GiB",
      separator: " ",
    });
  });

  it.each([
    [42, "42 ms"],
    [42.5, "42.5 ms"],
    [42.56789, "42.57 ms"],
    [1234.56789, "1234.57 ms"],
  ])("uses at most two decimals for axes and tooltips: %s", (value, expected) => {
    const formatter = createValueFormatter({ unit: "ms", scale: "none" });
    expect(formatter.format(value)).toBe(expected.replace("1234", "1,234"));
    expect(formatter.axis(2000)(value)).toBe(expected);
  });

  it("honors explicit precision in formatter axes and tooltips", () => {
    const formatter = createValueFormatter({
      unit: "ms",
      scale: "none",
      decimals: 3,
    });
    expect(formatter.format(42)).toBe("42.000 ms");
    expect(formatter.axis(100)(42.56789)).toBe("42.568 ms");
  });

  it("handles non-finite values without selecting a misleading scale", () => {
    expect(formatter("By", "binary").format(Infinity)).toBe("∞ B");
    expect(formatter("s", "duration").format(NaN)).toBe("NaN s");
  });

  it("validates duration input units while allowing arbitrary labels elsewhere", () => {
    expect(
      valueFormatSpec.safeParse({ unit: "widgets/s", scale: "decimal" })
        .success,
    ).toBe(true);
    expect(
      valueFormatSpec.safeParse({ unit: "widgets/s", scale: "duration" })
        .success,
    ).toBe(false);
    expect(
      valueFormatSpec.safeParse({ unit: "constructor", scale: "duration" })
        .success,
    ).toBe(false);
    expect(valueFormatSpec.safeParse({ decimals: 11 }).success).toBe(false);
    expect(valueFormatSpec.safeParse({ decimals: -1 }).success).toBe(false);
    expect(valueFormatSpec.safeParse({ scale: "auto" }).success).toBe(false);
  });
});
