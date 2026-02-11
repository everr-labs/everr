export { evaluate } from "./evaluate.js";
export { parse } from "./parse.js";
export { roundDate } from "./round.js";
export type {
  DateMathExpression,
  DateMathOp,
  DateMathOptions,
  DateMathUnit,
} from "./types.js";
export { DateMathError } from "./types.js";

import { evaluate } from "./evaluate.js";
import { parse } from "./parse.js";
import type { DateMathOptions } from "./types.js";

/**
 * Parse and evaluate a date math expression in a single call.
 *
 * This is a convenience wrapper around {@link parse} + {@link evaluate}.
 *
 * @param expression - The date math expression (e.g. `"now-1d/d"`).
 * @param options - Optional evaluation settings.
 * @returns The resolved `Date`.
 * @throws {DateMathError} If the expression is invalid.
 *
 * @example
 * ```ts
 * const date = resolve("now-24h", { now: new Date("2024-06-15T12:00:00Z") });
 * // 2024-06-14T12:00:00.000Z
 * ```
 */
export function resolve(expression: string, options?: DateMathOptions): Date {
  return evaluate(parse(expression), options);
}

/**
 * Check whether a date math expression string is syntactically valid.
 *
 * @param expression - The expression to validate.
 * @returns `true` if the expression can be parsed without errors, `false` otherwise.
 *
 * @example
 * ```ts
 * isValid("now-1d/d"); // true
 * isValid("invalid");  // false
 * ```
 */
export function isValid(expression: string): boolean {
  try {
    parse(expression);
    return true;
  } catch {
    return false;
  }
}
