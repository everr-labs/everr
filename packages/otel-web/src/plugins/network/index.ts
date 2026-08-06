import type { Plugin } from "../runtime.js";
import { type PropagationTarget, startNetwork } from "./network.js";

export type NetworkOptions = {
  /**
   * Cross-origin URLs that also receive the `traceparent` header (string =
   * substring match on the full URL, or RegExp). Same-origin requests always
   * propagate; a cross-origin backend must both be listed here and allow the
   * header in its CORS config (`Access-Control-Allow-Headers: traceparent`),
   * or its preflights will fail. Spans are recorded for every request
   * regardless; this gates only the header.
   */
  tracePropagationTargets?: PropagationTarget[];
};

/**
 * The network plugin: patches window.fetch so every request becomes a CLIENT
 * span on the traces pipeline and carries W3C trace context where
 * propagation is safe. Teardown unpatches (unless a later patcher won).
 */
export function network(options?: NetworkOptions): Plugin {
  return {
    name: "network",
    setup: (ctx) => startNetwork(ctx.tracer, options?.tracePropagationTargets),
  };
}
