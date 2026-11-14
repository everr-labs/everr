import { describe, expect, it } from "vite-plus/test";
import { parse } from "./parse.js";
import { DateMathError } from "./types.js";

describe("parse", () => {
  it.each(["now", "2024-01-01", "2024-01-15T10:30:00Z", "2024-01-15 10:30:00.123"])(
    "parses the bare anchor %s",
    (anchor) => {
      expect(parse(anchor)).toEqual({ anchor, ops: [] });
    },
  );

  it("parses now with subtract", () => {
    expect(parse("now-7d")).toEqual({
      anchor: "now",
      ops: [{ type: "sub", amount: 7, unit: "d" }],
    });
  });

  it("parses now with add", () => {
    expect(parse("now+1h")).toEqual({
      anchor: "now",
      ops: [{ type: "add", amount: 1, unit: "h" }],
    });
  });

  it("parses now with round", () => {
    expect(parse("now/d")).toEqual({
      anchor: "now",
      ops: [{ type: "round", amount: 1, unit: "d" }],
    });
  });

  it("parses chained operations", () => {
    expect(parse("now-7d/d")).toEqual({
      anchor: "now",
      ops: [
        { type: "sub", amount: 7, unit: "d" },
        { type: "round", amount: 1, unit: "d" },
      ],
    });
  });

  it("parses absolute date with || separator and math", () => {
    expect(parse("2024-01-01||+1M/d")).toEqual({
      anchor: "2024-01-01",
      ops: [
        { type: "add", amount: 1, unit: "M" },
        { type: "round", amount: 1, unit: "d" },
      ],
    });
  });

  it("parses implicit amount (defaults to 1)", () => {
    expect(parse("now+d")).toEqual({
      anchor: "now",
      ops: [{ type: "add", amount: 1, unit: "d" }],
    });
  });

  it("parses all units", () => {
    for (const unit of ["s", "m", "h", "d", "w", "M", "y"]) {
      const result = parse(`now+1${unit}`);
      expect(result.ops[0].unit).toBe(unit);
    }
  });

  it("ignores whitespace around operators", () => {
    expect(parse("now - 7d")).toEqual(parse("now-7d"));
  });

  it("parses multiple chained operations", () => {
    expect(parse("now-1y+3M/d")).toEqual({
      anchor: "now",
      ops: [
        { type: "sub", amount: 1, unit: "y" },
        { type: "add", amount: 3, unit: "M" },
        { type: "round", amount: 1, unit: "d" },
      ],
    });
  });

  it.each([
    ["an empty expression", ""],
    ["an invalid unit", "now+1x"],
    ["an invalid absolute date", "not-a-date||+1d"],
    ["a trailing operator", "now+"],
    ["a missing unit after /", "now/"],
  ])("throws on %s, naming the expression", (_, expression) => {
    expect(() => parse(expression)).toThrow(DateMathError);
    expect(() => parse(expression)).toThrow(expect.objectContaining({ expression }));
  });
});
