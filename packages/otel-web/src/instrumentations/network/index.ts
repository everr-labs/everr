import type { Instrumentation } from "../runtime.js";
import {
  type PropagationTarget,
  type RouteTemplateResolver,
  startNetwork,
} from "./network.js";

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
  /**
   * Maps a request URL to the low-cardinality route template of the endpoint
   * it hits (`/api/posts/123` -> `/api/posts/{id}`), used as the span name
   * (`GET /api/posts/{id}`) and stamped as semconv `url.template`. This is the
   * request's own route, unrelated to the page's route pattern from
   * `setRouteResolver`. Without it, spans are named by the request path.
   */
  resolveRouteTemplate?: RouteTemplateResolver;
};

/**
 * The network instrumentation: patches window.fetch so every request becomes a CLIENT
 * span on the traces pipeline and carries W3C trace context where
 * propagation is safe. Teardown unpatches (unless a later patcher won).
 */
export function network(options?: NetworkOptions): Instrumentation {
  // Named (not an arrow) so sampled() can hash a real identity from
  // instrumentation.name instead of decorrelating nothing.
  return function network(ctx) {
    return startNetwork(
      ctx.tracer,
      options?.tracePropagationTargets,
      options?.resolveRouteTemplate,
    );
  };
}
