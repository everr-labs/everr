import type { Instrumentation } from "../runtime.js";
import {
  type PropagationTarget,
  type RouteTemplateResolver,
  startNetwork,
} from "./network.js";

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
  /**
   * Changes the URL of a request into the route template of the endpoint, for
   * example `/api/posts/123` into `/api/posts/{id}`. That template has a small
   * number of different values. The SDK uses it as the name of the span, for
   * example `GET /api/posts/{id}`, and it writes it as the semconv attribute
   * `url.template`.
   *
   * This is the route of the request. It has no relation to the route pattern
   * of the page from `setRouteResolver`. Without this function, the name of a
   * span is the path of the request.
   */
  resolveRouteTemplate?: RouteTemplateResolver;
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
    return startNetwork(
      ctx.tracer,
      options?.tracePropagationTargets,
      options?.resolveRouteTemplate,
    );
  };
}
