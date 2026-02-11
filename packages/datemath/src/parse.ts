import type { DateMathExpression, DateMathOp, DateMathUnit } from "./types.js";
import { DateMathError } from "./types.js";

const VALID_UNITS = new Set<string>(["s", "m", "h", "d", "w", "M", "y"]);

/**
 * Parse a date math expression string into a structured {@link DateMathExpression}.
 *
 * Supports `"now"` as a relative anchor or an ISO-8601 date string separated
 * from math operators by `||`. Operators are `+`, `-`, and `/` (round) followed
 * by an optional amount and a unit.
 *
 * @param expression - The date math expression to parse (e.g. `"now-1d/d"`, `"2024-01-01||+1M"`).
 * @returns The parsed expression object.
 * @throws {DateMathError} If the expression is empty, has an invalid anchor, or contains invalid operators.
 *
 * @example
 * ```ts
 * const expr = parse("now-7d/d");
 * // { anchor: "now", ops: [{ type: "sub", amount: 7, unit: "d" }, { type: "round", amount: 1, unit: "d" }] }
 * ```
 */
export function parse(expression: string): DateMathExpression {
  const input = expression.replace(/\s/g, "");

  if (input.length === 0) {
    throw new DateMathError("Empty expression", expression);
  }

  let anchor: string;
  let mathPart: string;

  if (input.startsWith("now")) {
    anchor = "now";
    mathPart = input.slice(3);
  } else {
    const separatorIndex = input.indexOf("||");
    if (separatorIndex !== -1) {
      anchor = input.slice(0, separatorIndex);
      mathPart = input.slice(separatorIndex + 2);
    } else {
      anchor = input;
      mathPart = "";
    }
  }

  if (anchor !== "now" && anchor.length === 0) {
    throw new DateMathError("Empty anchor", expression);
  }

  // Validate absolute anchor is a parseable date
  if (anchor !== "now") {
    const parsed = Date.parse(anchor);
    if (Number.isNaN(parsed)) {
      throw new DateMathError(`Invalid date anchor: ${anchor}`, expression, 0);
    }
  }

  const ops = parseMathOps(mathPart, expression);

  return { anchor, ops };
}

function parseMathOps(math: string, expression: string): DateMathOp[] {
  const ops: DateMathOp[] = [];
  let pos = 0;

  while (pos < math.length) {
    const char = math[pos];

    if (char === "/") {
      // Round operation
      pos++;
      if (pos >= math.length) {
        throw new DateMathError("Expected unit after /", expression, pos);
      }
      const unit = math[pos];
      if (!VALID_UNITS.has(unit)) {
        throw new DateMathError(`Invalid unit: ${unit}`, expression, pos);
      }
      ops.push({ type: "round", amount: 1, unit: unit as DateMathUnit });
      pos++;
    } else if (char === "+" || char === "-") {
      // Add or subtract operation
      const type = char === "+" ? "add" : "sub";
      pos++;

      // Parse optional amount (digits)
      let amountStr = "";
      while (pos < math.length && math[pos] >= "0" && math[pos] <= "9") {
        amountStr += math[pos];
        pos++;
      }

      if (pos >= math.length) {
        throw new DateMathError(
          "Expected unit after operator",
          expression,
          pos,
        );
      }

      const unit = math[pos];
      if (!VALID_UNITS.has(unit)) {
        throw new DateMathError(`Invalid unit: ${unit}`, expression, pos);
      }

      const amount = amountStr.length > 0 ? Number.parseInt(amountStr, 10) : 1;
      ops.push({ type, amount, unit: unit as DateMathUnit });
      pos++;
    } else {
      throw new DateMathError(`Unexpected character: ${char}`, expression, pos);
    }
  }

  return ops;
}
