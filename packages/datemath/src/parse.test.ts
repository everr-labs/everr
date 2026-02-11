import { describe, expect, it } from "vitest";
import { parse } from "./parse.js";
import { DateMathError } from "./types.js";

describe("parse", () => {
  it("parses 'now' anchor", () => {
    expect(parse("now")).toEqual({ anchor: "now", ops: [] });
  });

  it("parses absolute anchor", () => {
    expect(parse("2024-01-01")).toEqual({ anchor: "2024-01-01", ops: [] });
  });

  it("parses absolute anchor with time", () => {
    expect(parse("2024-01-15T10:30:00Z")).toEqual({
      anchor: "2024-01-15T10:30:00Z",
      ops: [],
    });
  });

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

  it("strips whitespace", () => {
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

  it("throws on empty expression", () => {
    expect(() => parse("")).toThrow(DateMathError);
  });

  it("throws on invalid unit", () => {
    expect(() => parse("now+1x")).toThrow(DateMathError);
  });

  it("throws on invalid absolute date", () => {
    expect(() => parse("not-a-date||+1d")).toThrow(DateMathError);
  });

  it("throws on trailing operator", () => {
    expect(() => parse("now+")).toThrow(DateMathError);
  });

  it("throws on missing unit after /", () => {
    expect(() => parse("now/")).toThrow(DateMathError);
  });

  it("includes expression in error", () => {
    try {
      parse("now+1x");
    } catch (e) {
      expect(e).toBeInstanceOf(DateMathError);
      expect((e as DateMathError).expression).toBe("now+1x");
    }
  });
});
