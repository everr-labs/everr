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
 * Captures fetch and XMLHttpRequest as CLIENT spans, propagating W3C trace
 * context to the same origin and configured targets. Everr owns XHR trace
 * headers. Teardown restores methods unless another
 * module replaced them, and detaches listeners from unfinished XHR requests.
 */
export function network(options?: NetworkOptions): Instrumentation {
  // This function has a name and it is not an arrow function. Thus sampled()
  // can make a hash from instrumentation.name, and the decisions for the
  // different instrumentations are different.
  return function network(ctx) {
    return startNetwork(ctx.tracer, options?.tracePropagationTargets);
  };
}
