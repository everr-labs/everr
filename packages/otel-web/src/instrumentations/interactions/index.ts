import type { Instrumentation } from "../runtime.js";
import { startInteractions } from "./interactions.js";

/**
 * The interactions instrumentation. It captures the behavior of the user
 * automatically: a click, a change of a form field, a submit, and a rage click.
 * The performance instrumentation captures the slow interactions, which use the
 * latency from Event Timing.
 */
export function interactions(): Instrumentation {
  // This function has a name and it is not an arrow function. Thus sampled()
  // can make a hash from instrumentation.name, and the decisions for the
  // different instrumentations are different.
  return function interactions(ctx) {
    return startInteractions(ctx.emit);
  };
}
