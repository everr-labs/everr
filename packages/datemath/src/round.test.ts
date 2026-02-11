import { describe, expect, it } from "vitest";
import { roundDate } from "./round.js";

// Wednesday, 2025-06-15 14:30:45.123
const BASE = new Date(2025, 5, 15, 14, 30, 45, 123);

describe("roundDate - round down", () => {
  it("rounds down to second", () => {
    const result = roundDate(BASE, "s", false);
    expect(result).toEqual(new Date(2025, 5, 15, 14, 30, 45, 0));
  });

  it("rounds down to minute", () => {
    const result = roundDate(BASE, "m", false);
    expect(result).toEqual(new Date(2025, 5, 15, 14, 30, 0, 0));
  });

  it("rounds down to hour", () => {
    const result = roundDate(BASE, "h", false);
    expect(result).toEqual(new Date(2025, 5, 15, 14, 0, 0, 0));
  });

  it("rounds down to day", () => {
    const result = roundDate(BASE, "d", false);
    expect(result).toEqual(new Date(2025, 5, 15, 0, 0, 0, 0));
  });

  it("rounds down to week (Monday)", () => {
    // June 15, 2025 is a Sunday → should round to Monday June 9
    const result = roundDate(BASE, "w", false);
    expect(result).toEqual(new Date(2025, 5, 9, 0, 0, 0, 0));
    expect(result.getDay()).toBe(1); // Monday
  });

  it("rounds down to week when already Monday", () => {
    const monday = new Date(2025, 5, 9, 10, 0, 0, 0);
    const result = roundDate(monday, "w", false);
    expect(result).toEqual(new Date(2025, 5, 9, 0, 0, 0, 0));
  });

  it("rounds down to month", () => {
    const result = roundDate(BASE, "M", false);
    expect(result).toEqual(new Date(2025, 5, 1, 0, 0, 0, 0));
  });

  it("rounds down to year", () => {
    const result = roundDate(BASE, "y", false);
    expect(result).toEqual(new Date(2025, 0, 1, 0, 0, 0, 0));
  });
});

describe("roundDate - round up", () => {
  it("rounds up to second", () => {
    const result = roundDate(BASE, "s", true);
    expect(result).toEqual(new Date(2025, 5, 15, 14, 30, 45, 999));
  });

  it("rounds up to minute", () => {
    const result = roundDate(BASE, "m", true);
    expect(result).toEqual(new Date(2025, 5, 15, 14, 30, 59, 999));
  });

  it("rounds up to hour", () => {
    const result = roundDate(BASE, "h", true);
    expect(result).toEqual(new Date(2025, 5, 15, 14, 59, 59, 999));
  });

  it("rounds up to day", () => {
    const result = roundDate(BASE, "d", true);
    expect(result).toEqual(new Date(2025, 5, 15, 23, 59, 59, 999));
  });

  it("rounds up to week (Sunday)", () => {
    // June 15, 2025 is a Sunday → week starts Monday June 9, ends Sunday June 15
    const result = roundDate(BASE, "w", true);
    expect(result).toEqual(new Date(2025, 5, 15, 23, 59, 59, 999));
    expect(result.getDay()).toBe(0); // Sunday
  });

  it("rounds up to month", () => {
    const result = roundDate(BASE, "M", true);
    // June has 30 days
    expect(result).toEqual(new Date(2025, 5, 30, 23, 59, 59, 999));
  });

  it("rounds up to month - February leap year", () => {
    const feb = new Date(2024, 1, 15, 12, 0, 0, 0);
    const result = roundDate(feb, "M", true);
    expect(result).toEqual(new Date(2024, 1, 29, 23, 59, 59, 999));
  });

  it("rounds up to month - February non-leap year", () => {
    const feb = new Date(2025, 1, 15, 12, 0, 0, 0);
    const result = roundDate(feb, "M", true);
    expect(result).toEqual(new Date(2025, 1, 28, 23, 59, 59, 999));
  });

  it("rounds up to year", () => {
    const result = roundDate(BASE, "y", true);
    expect(result).toEqual(new Date(2025, 11, 31, 23, 59, 59, 999));
  });
});

describe("roundDate - edge cases", () => {
  it("handles Saturday for week rounding", () => {
    // June 14, 2025 is a Saturday
    const saturday = new Date(2025, 5, 14, 12, 0, 0, 0);
    const result = roundDate(saturday, "w", false);
    expect(result).toEqual(new Date(2025, 5, 9, 0, 0, 0, 0));
  });

  it("handles month with 31 days", () => {
    const jan = new Date(2025, 0, 15, 12, 0, 0, 0);
    const result = roundDate(jan, "M", true);
    expect(result).toEqual(new Date(2025, 0, 31, 23, 59, 59, 999));
  });

  it("does not mutate the input date", () => {
    const original = new Date(BASE.getTime());
    roundDate(BASE, "d", false);
    expect(BASE.getTime()).toBe(original.getTime());
  });
});
