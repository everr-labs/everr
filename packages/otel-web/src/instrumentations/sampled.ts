import type { Instrumentation } from "./runtime.js";

/**
 * Permits or refuses the full setup of an instrumentation, for each session.
 * The code makes a hash from the session id and the name of the
 * instrumentation. At the start it uses that hash one time to decide if the
 * instrumentation operates. If the decision refuses the session, the
 * instrumentation adds no listener and captures nothing.
 *
 * The decision uses the store of the session id, and it keeps no data of its
 * own. Thus the decision is the same in all the tabs and after a reload. Also,
 * a new session during the page cannot change a decision from the setup.
 *
 * The code uses `instrumentation.name` to make the decisions different. Two
 * instrumentations in the same session get different decisions only when their
 * setup functions have names. Each built-in function gives a name to the
 * function that it returns, for this reason. An instrumentation without a name
 * still gets the same decision each time, but that decision is the same as the
 * decision for each other instrumentation without a name in the same session.
 */
export function sampled(
  instrumentation: Instrumentation,
  rate: number,
): Instrumentation {
  const clamped = rate <= 0 ? 0 : rate >= 1 ? 1 : rate;
  const wrapped: Instrumentation = (ctx) => {
    if (clamped <= 0) return;
    if (clamped < 1) {
      const { sessionId } = ctx.ids();
      if (hashUnit(`${sessionId}:${instrumentation.name}`) >= clamped) return;
    }
    return instrumentation(ctx);
  };
  Object.defineProperty(wrapped, "name", { value: instrumentation.name });
  return wrapped;
}

/**
 * The djb2 hash. The code changes it to an unsigned 32-bit integer, then to a
 * value from 0 to less than 1.
 */
export function hashUnit(input: string): number {
  let hash = 5381;
  for (let i = 0; i < input.length; i++) {
    hash = (hash * 33) ^ input.charCodeAt(i);
  }
  return (hash >>> 0) / 4294967296;
}
