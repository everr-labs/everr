import type { Plugin } from "./runtime.js";

/**
 * Gates a plugin's entire setup by session: a hash of the session id and
 * the plugin's name decides once, at init, whether the wrapped plugin runs
 * at all. A sampled-out session attaches no listeners and pays zero
 * capture cost. The decision rides the session id's own persistence (no
 * storage of its own), so it is stable across tabs and reloads, and mid-page
 * session rotation cannot change a decision already made at setup.
 *
 * Decorrelates by `plugin.name`: two different plugins wrapped for the same
 * session get independent decisions only if their setup functions are named
 * (every built-in factory names its returned function for this reason). An
 * anonymous plugin still samples deterministically, just correlated with
 * any other anonymous plugin sampled in the same session.
 */
export function sampled(plugin: Plugin, rate: number): Plugin {
  const clamped = rate <= 0 ? 0 : rate >= 1 ? 1 : rate;
  const wrapped: Plugin = (ctx) => {
    if (clamped <= 0) return;
    if (clamped < 1) {
      const { sessionId } = ctx.ids();
      if (hashUnit(`${sessionId}:${plugin.name}`) >= clamped) return;
    }
    return plugin(ctx);
  };
  Object.defineProperty(wrapped, "name", { value: plugin.name });
  return wrapped;
}

/**
 * djb2, folded to an unsigned 32-bit int and normalized to [0, 1). Shared
 * with the performance plugin's pageLoad sampling.
 */
export function hashUnit(input: string): number {
  let hash = 5381;
  for (let i = 0; i < input.length; i++) {
    hash = (hash * 33) ^ input.charCodeAt(i);
  }
  return (hash >>> 0) / 4294967296;
}
