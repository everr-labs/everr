import type { Plugin } from "../runtime.js";
import { startInteractions } from "./interactions.js";

/**
 * The interactions plugin: behavioral autocapture only; click, form-field
 * change, submit, and rage click. Slow interactions (Event Timing latency)
 * belong to the performance plugin.
 */
export function interactions(): Plugin {
  return (ctx) => startInteractions(ctx.emit);
}
