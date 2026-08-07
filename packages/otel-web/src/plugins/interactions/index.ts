import type { Plugin } from "../runtime.js";
import { startInteractions } from "./interactions.js";

/**
 * The interactions plugin: behavioral autocapture only; click, form-field
 * change, submit, and rage click. Slow interactions (Event Timing latency)
 * belong to the performance plugin.
 */
export function interactions(): Plugin {
  // Named (not an arrow) so sampled() can hash a real identity from
  // plugin.name instead of decorrelating nothing.
  return function interactions(ctx) {
    return startInteractions(ctx.emit);
  };
}
