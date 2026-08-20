import type { Attributes, TextMapGetter } from "@opentelemetry/api";
import { context, propagation } from "@opentelemetry/api";
import { getRouter } from "@/router";
import { captureError, getTelemetryTracer, SpanKind } from "./node";
import { type RouterLike, routeTemplate } from "./route-template";
import {
  runWithServerFunctionName,
  type ServerFunctionName,
} from "./server-fn-name";

const tracer = getTelemetryTracer();

// The rendering router does not exist yet when this wrapper needs http.route:
// Start builds it lazily inside the handler we wrap, bound to that request's
// history. So matching gets its own router, from the same factory for the
// reason documented on `getRouter`, built once per process on first request.
let matcher: RouterLike | undefined;

// Read W3C headers off a Fetch `Headers` object for context extraction.
const headersGetter: TextMapGetter<Headers> = {
  keys: (carrier) => [...carrier.keys()],
  get: (carrier, key) => carrier.get(key) ?? undefined,
};

/**
 * Wraps a fetch handler so every request it serves gets a SERVER span named
 * `<METHOD> <route-template>`.
 */
export function instrumentFetch<TRest extends unknown[]>(
  fetch: (request: Request, ...rest: TRest) => Response | Promise<Response>,
) {
  return async (request: Request, ...rest: TRest): Promise<Response> => {
    const run = () => fetch(request, ...rest);
    const pathname = new URL(request.url).pathname;
    matcher ??= getRouter({ forRouteMatchingOnly: true });
    const route = routeTemplate(matcher, pathname);
    const method = request.method.toUpperCase();

    // For server function requests the path only carries the opaque id; the
    // middleware knows the function's name and reports it into this holder, so
    // the span and the route echo can say `/_serverFn/{name}` instead.
    const serverFn: ServerFunctionName | undefined = pathname.startsWith(
      "/_serverFn/",
    )
      ? {}
      : undefined;

    // Continue a trace started by a first-party client (e.g. the CLI, which
    // injects `traceparent`) instead of starting a fresh root. Requests without
    // the header extract to an empty context, so this span roots itself as before.
    const parentContext = propagation.extract(
      context.active(),
      request.headers,
      headersGetter,
    );

    return tracer.startActiveSpan(
      route === undefined ? method : `${method} ${route}`,
      {
        attributes: requestAttributes(request, pathname, route, method),
        kind: SpanKind.SERVER,
      },
      parentContext,
      async (span) => {
        // The middleware fills the holder mid-flight, so the route is only
        // final after `run` settles (or throws past the middleware).
        const resolvedRoute = () =>
          serverFn?.name ? `/_serverFn/${serverFn.name}` : route;
        try {
          const response = await (serverFn
            ? runWithServerFunctionName(serverFn, run)
            : run());

          const finalRoute = resolvedRoute();
          // Echo the derived route so the browser SDK can stamp url.template on
          // its client span: the client route tree has no server-only routes, so
          // this header is the browser's only exact source for API templates.
          if (finalRoute !== undefined) {
            try {
              response.headers.set("x-everr-route", finalRoute);
            } catch {
              // A response with immutable headers keeps them; the span is
              // unaffected.
            }
          }

          span.setAttribute("http.response.status_code", response.status);
          if (response.status >= 500) {
            captureError(new Error(`HTTP ${response.status}`), {
              "everr.error.source": "server.response",
              "http.request.method": method,
              "http.response.status_code": response.status,
              ...(finalRoute === undefined ? {} : { "http.route": finalRoute }),
              "url.path": pathname,
            });
          }

          return response;
        } catch (error) {
          const finalRoute = resolvedRoute();
          captureError(error, {
            "everr.error.source": "server.fetch",
            "http.request.method": method,
            ...(finalRoute === undefined ? {} : { "http.route": finalRoute }),
            "url.path": pathname,
          });
          throw error;
        } finally {
          const finalRoute = resolvedRoute();
          if (finalRoute !== undefined && finalRoute !== route) {
            span.updateName(`${method} ${finalRoute}`);
            span.setAttribute("http.route", finalRoute);
          }
          span.end();
        }
      },
    );
  };
}

function requestAttributes(
  request: Request,
  pathname: string,
  route: string | undefined,
  method: string,
): Attributes {
  return {
    "http.request.method": method,
    ...(route === undefined ? {} : { "http.route": route }),
    "url.path": pathname,
    "url.scheme": new URL(request.url).protocol.replace(/:$/, ""),
  };
}
