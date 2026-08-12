import type { Instrumentation } from "../runtime.js";
import { type PropagationTarget, startNetwork } from "./network.js";

export type NetworkOptions = {
  /**
   * The URLs of a different origin that also receive the `traceparent` header.
   * A string must occur in the full URL, and a RegExp must agree with the full
   * URL.
   *
   * A request to the same origin always carries the header. A server of a
   * different origin must be in this list, and it must also permit the header
   * in its CORS configuration with `Access-Control-Allow-Headers: traceparent`.
   * If not, its preflight requests fail. The SDK records a span for each
   * request in all conditions. This option controls only the header.
   */
  tracePropagationTargets?: PropagationTarget[];
};

/**
 * The network instrumentation. It changes window.fetch. Thus each request
 * becomes a CLIENT span on the traces pipeline, and it carries the W3C trace
 * context when that is safe. The teardown restores the original fetch, but not
 * when a different module changed fetch after this module.
 */
export function network(options?: NetworkOptions): Instrumentation {
  // This function has a name and it is not an arrow function. Thus sampled()
  // can make a hash from instrumentation.name, and the decisions for the
  // different instrumentations are different.
  return function network(ctx) {
    return startNetwork(ctx.tracer, options?.tracePropagationTargets);
  };
}
