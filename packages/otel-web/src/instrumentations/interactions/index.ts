import type { Instrumentation } from "../runtime.js";
import { startInteractions } from "./interactions.js";

/**
 * The interactions instrumentation: behavioral autocapture only; click, form-field
 * change, submit, and rage click. Slow interactions (Event Timing latency)
 * belong to the performance instrumentation.
 */
export function interactions(): Instrumentation {
  // Named (not an arrow) so sampled() can hash a real identity from
  // instrumentation.name instead of decorrelating nothing.
  return function interactions(ctx) {
    return startInteractions(ctx.emit);
  };
}
