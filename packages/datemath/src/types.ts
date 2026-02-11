/** Time unit for date math operations: `s`econds, `m`inutes, `h`ours, `d`ays, `w`eeks, `M`onths, or `y`ears. */
export type DateMathUnit = "s" | "m" | "h" | "d" | "w" | "M" | "y";

/** A single add, subtract, or round operation within a date math expression. */
export interface DateMathOp {
  type: "add" | "sub" | "round";
  amount: number;
  unit: DateMathUnit;
}

/** Parsed representation of a date math expression, consisting of an anchor and a sequence of operations. */
export interface DateMathExpression {
  /** Either the literal `"now"` or an ISO-8601 date string. */
  anchor: "now" | string;
  /** Ordered list of operations to apply to the anchor. */
  ops: DateMathOp[];
}

/** Options for evaluating a date math expression. */
export interface DateMathOptions {
  /** Override the current time used when the anchor is `"now"`. */
  now?: Date;
  /** When `true`, rounding operations snap to the end of the period instead of the start. */
  roundUp?: boolean;
}

/**
 * Error thrown when a date math expression cannot be parsed or evaluated.
 *
 * @example
 * ```ts
 * try { parse("invalid"); } catch (e) {
 *   if (e instanceof DateMathError) console.log(e.expression, e.position);
 * }
 * ```
 */
export class DateMathError extends Error {
  /** The original expression string that caused the error. */
  expression: string;
  /** Character offset within the expression where the error was detected. */
  position?: number;

  constructor(message: string, expression: string, position?: number) {
    super(message);
    this.name = "DateMathError";
    this.expression = expression;
    this.position = position;
  }
}
