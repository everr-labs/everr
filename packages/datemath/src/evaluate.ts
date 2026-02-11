import { roundDate } from "./round.js";
import type {
  DateMathExpression,
  DateMathOptions,
  DateMathUnit,
} from "./types.js";
import { DateMathError } from "./types.js";

/**
 * Evaluate a parsed date math expression into a concrete `Date`.
 *
 * Resolves the anchor to a `Date`, then applies each operation (add, subtract, round)
 * in order.
 *
 * @param expr - A parsed {@link DateMathExpression} (from {@link parse}).
 * @param options - Optional settings: override `now` or enable `roundUp`.
 * @returns The computed `Date`.
 * @throws {DateMathError} If the anchor date is invalid.
 *
 * @example
 * ```ts
 * const date = evaluate(parse("now-1h"), { now: new Date("2024-06-15T12:00:00Z") });
 * // 2024-06-15T11:00:00.000Z
 * ```
 */
export function evaluate(
  expr: DateMathExpression,
  options?: DateMathOptions,
): Date {
  let date: Date;

  if (expr.anchor === "now") {
    date = options?.now ? new Date(options.now.getTime()) : new Date();
  } else {
    const timestamp = Date.parse(expr.anchor);
    if (Number.isNaN(timestamp)) {
      throw new DateMathError(
        `Invalid date anchor: ${expr.anchor}`,
        expr.anchor,
      );
    }
    date = new Date(timestamp);
  }

  for (const op of expr.ops) {
    if (op.type === "round") {
      date = roundDate(date, op.unit, options?.roundUp ?? false);
    } else {
      const amount = op.type === "sub" ? -op.amount : op.amount;
      addToDate(date, amount, op.unit);
    }
  }

  return date;
}

function addToDate(date: Date, amount: number, unit: DateMathUnit): void {
  switch (unit) {
    case "s":
      date.setSeconds(date.getSeconds() + amount);
      break;
    case "m":
      date.setMinutes(date.getMinutes() + amount);
      break;
    case "h":
      date.setHours(date.getHours() + amount);
      break;
    case "d":
      date.setDate(date.getDate() + amount);
      break;
    case "w":
      date.setDate(date.getDate() + amount * 7);
      break;
    case "M":
      date.setMonth(date.getMonth() + amount);
      break;
    case "y":
      date.setFullYear(date.getFullYear() + amount);
      break;
  }
}
