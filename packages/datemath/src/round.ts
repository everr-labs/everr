import type { DateMathUnit } from "./types.js";

/**
 * Round a date down (or up) to the boundary of the given time unit.
 *
 * Rounding down truncates to the start of the period (e.g. start of day).
 * Rounding up first truncates, then advances to the end of the period
 * (e.g. `23:59:59.999` for days). Weeks use ISO-8601 (Monday start).
 *
 * @param date - The date to round.
 * @param unit - The time unit to round to.
 * @param roundUp - If `true`, round to the end of the period instead of the start.
 * @returns A new `Date` with the rounding applied.
 *
 * @example
 * ```ts
 * roundDate(new Date("2024-06-15T14:30:00Z"), "d", false);
 * // 2024-06-15T00:00:00.000Z
 * ```
 */
export function roundDate(
  date: Date,
  unit: DateMathUnit,
  roundUp: boolean,
): Date {
  const result = new Date(date.getTime());

  if (roundUp) {
    roundDownDate(result, unit);
    advanceToEndOfPeriod(result, unit);
  } else {
    roundDownDate(result, unit);
  }

  return result;
}

function roundDownDate(date: Date, unit: DateMathUnit): void {
  switch (unit) {
    case "y":
      date.setMonth(0, 1);
      date.setHours(0, 0, 0, 0);
      break;
    case "M":
      date.setDate(1);
      date.setHours(0, 0, 0, 0);
      break;
    case "w": {
      // ISO 8601: week starts on Monday
      const day = date.getDay();
      // Sunday = 0, Monday = 1, ..., Saturday = 6
      // To get to Monday: subtract (day - 1), but handle Sunday (0) as 7
      const diff = day === 0 ? 6 : day - 1;
      date.setDate(date.getDate() - diff);
      date.setHours(0, 0, 0, 0);
      break;
    }
    case "d":
      date.setHours(0, 0, 0, 0);
      break;
    case "h":
      date.setMinutes(0, 0, 0);
      break;
    case "m":
      date.setSeconds(0, 0);
      break;
    case "s":
      date.setMilliseconds(0);
      break;
  }
}

function advanceToEndOfPeriod(date: Date, unit: DateMathUnit): void {
  switch (unit) {
    case "y":
      date.setMonth(11, 31);
      date.setHours(23, 59, 59, 999);
      break;
    case "M":
      // Last day of current month: set to day 0 of next month
      date.setMonth(date.getMonth() + 1, 0);
      date.setHours(23, 59, 59, 999);
      break;
    case "w":
      date.setDate(date.getDate() + 6);
      date.setHours(23, 59, 59, 999);
      break;
    case "d":
      date.setHours(23, 59, 59, 999);
      break;
    case "h":
      date.setMinutes(59, 59, 999);
      break;
    case "m":
      date.setSeconds(59, 999);
      break;
    case "s":
      date.setMilliseconds(999);
      break;
  }
}
