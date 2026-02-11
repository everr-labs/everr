import { describe, expect, it, vi } from "vitest";
import { evaluate } from "./evaluate.js";
import { isValid, resolve } from "./index.js";
import { parse } from "./parse.js";

const NOW = new Date("2025-06-15T12:00:00.000Z");

describe("evaluate", () => {
  it("resolves 'now' to current time", () => {
    const result = evaluate(parse("now"), { now: NOW });
    expect(result).toEqual(NOW);
  });

  it("resolves 'now' to Date.now() when no option given", () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const result = evaluate(parse("now"));
    expect(result).toEqual(NOW);
    vi.useRealTimers();
  });

  it("subtracts seconds", () => {
    const result = evaluate(parse("now-30s"), { now: NOW });
    expect(result).toEqual(new Date("2025-06-15T11:59:30.000Z"));
  });

  it("adds minutes", () => {
    const result = evaluate(parse("now+15m"), { now: NOW });
    expect(result).toEqual(new Date("2025-06-15T12:15:00.000Z"));
  });

  it("subtracts hours", () => {
    const result = evaluate(parse("now-3h"), { now: NOW });
    expect(result).toEqual(new Date("2025-06-15T09:00:00.000Z"));
  });

  it("subtracts days", () => {
    const result = evaluate(parse("now-7d"), { now: NOW });
    expect(result).toEqual(new Date("2025-06-08T12:00:00.000Z"));
  });

  it("adds weeks", () => {
    const result = evaluate(parse("now+2w"), { now: NOW });
    expect(result).toEqual(new Date("2025-06-29T12:00:00.000Z"));
  });

  it("subtracts months", () => {
    const result = evaluate(parse("now-1M"), { now: NOW });
    expect(result).toEqual(new Date("2025-05-15T12:00:00.000Z"));
  });

  it("adds years", () => {
    const result = evaluate(parse("now+1y"), { now: NOW });
    expect(result).toEqual(new Date("2026-06-15T12:00:00.000Z"));
  });

  it("handles absolute date anchor", () => {
    const result = evaluate(parse("2024-01-01||+1M"));
    const expected = new Date("2024-01-01T00:00:00.000Z");
    expected.setMonth(expected.getMonth() + 1);
    expect(result).toEqual(expected);
  });

  it("handles chained operations", () => {
    const result = evaluate(parse("now-7d/d"), { now: NOW });
    const expected = new Date("2025-06-08T00:00:00.000Z");
    // Round to start of day in local time
    expected.setHours(0, 0, 0, 0);
    // The result rounds in local time, so compare with local-time expectation
    const resultLocal = new Date(2025, 5, 8, 0, 0, 0, 0);
    expect(result).toEqual(resultLocal);
  });

  it("handles roundUp option", () => {
    const result = evaluate(parse("now/d"), { now: NOW, roundUp: true });
    // Should be end of day in local time
    const year = NOW.getFullYear();
    const month = NOW.getMonth();
    const day = NOW.getDate();
    expect(result).toEqual(new Date(year, month, day, 23, 59, 59, 999));
  });

  it("handles implicit amount", () => {
    const result = evaluate(parse("now+d"), { now: NOW });
    const expected = new Date(NOW.getTime());
    expected.setDate(expected.getDate() + 1);
    expect(result).toEqual(expected);
  });

  it("handles multiple add/sub operations", () => {
    const result = evaluate(parse("now+1y-3M"), { now: NOW });
    const expected = new Date(NOW.getTime());
    expected.setFullYear(expected.getFullYear() + 1);
    expected.setMonth(expected.getMonth() - 3);
    expect(result).toEqual(expected);
  });
});

describe("resolve", () => {
  it("parses and evaluates in one call", () => {
    const result = resolve("now-1d", { now: NOW });
    expect(result).toEqual(new Date("2025-06-14T12:00:00.000Z"));
  });

  it("works with absolute dates", () => {
    const result = resolve("2024-06-01||+1d");
    const expected = new Date("2024-06-01T00:00:00.000Z");
    expected.setDate(expected.getDate() + 1);
    expect(result).toEqual(expected);
  });
});

describe("isValid", () => {
  it("returns true for valid expressions", () => {
    expect(isValid("now")).toBe(true);
    expect(isValid("now-7d")).toBe(true);
    expect(isValid("now/d")).toBe(true);
    expect(isValid("2024-01-01||+1M")).toBe(true);
  });

  it("returns false for invalid expressions", () => {
    expect(isValid("")).toBe(false);
    expect(isValid("now+1x")).toBe(false);
    expect(isValid("invalid-date||+1d")).toBe(false);
  });
});
