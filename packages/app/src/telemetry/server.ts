import type { Attributes, TextMapGetter } from "@opentelemetry/api";
import { context, propagation } from "@opentelemetry/api";
import { createMiddleware } from "@tanstack/react-start";
import { getRouter } from "@/router";
import { captureError, getTelemetryTracer, SpanKind } from "./node";
import { type RouterLike, routeTemplate } from "./route-template";
import {
  runWithServerFunctionName,
  type ServerFunctionName,
} from "./server-fn-name";

const tracer = getTelemetryTracer();

// The rendering router does not exist yet when this middleware needs
// http.route: Start builds it lazily further down the same request, bound to
// that request's history. So matching gets its own router, from the same
// factory for the reason documented on `getRouter`, built once per process.
let matcher: RouterLike | undefined;

// Read W3C headers off a Fetch `Headers` object for context extraction.
const headersGetter: TextMapGetter<Headers> = {
  keys: (carrier) => [...carrier.keys()],
  get: (carrier, key) => carrier.get(key) ?? undefined,
};

/**
 * Global request middleware: every request Start serves, SSR and server
 * functions alike, gets a SERVER span named `<METHOD> <route-template>`.
 */
export const requestTelemetryMiddleware = createMiddleware({
  type: "request",
}).server(async ({ request, pathname, handlerType, next }) => {
  matcher ??= getRouter();
  const route = routeTemplate(matcher, pathname);
  const method = request.method.toUpperCase();

  // A server function request carries only the opaque id in its path. Start
  // does not hand the name to request middleware, so the function middleware
  // reports it into this holder mid-flight and the route can settle on
  // `/_serverFn/{name}` once the call returns.
  const serverFn: ServerFunctionName | undefined =
    handlerType === "serverFn" ? {} : undefined;
  const resolved = () =>
    serverFn?.name ? `/_serverFn/${serverFn.name}` : route;
  const attrs = (
    route: string | undefined,
    extra?: Attributes,
  ): Attributes => ({
    "http.request.method": method,
    "url.path": pathname,
    ...(route === undefined ? {} : { "http.route": route }),
    ...extra,
  });

  return tracer.startActiveSpan(
    route === undefined ? method : `${method} ${route}`,
    {
      // Continue a trace a first-party client started (the browser, or the CLI
      // injecting `traceparent`). No header extracts to an empty context, and
      // the span roots itself.
      attributes: attrs(route, {
        "url.scheme": new URL(request.url).protocol.replace(/:$/, ""),
      }),
      kind: SpanKind.SERVER,
    },
    propagation.extract(context.active(), request.headers, headersGetter),
    async (span) => {
      let final = route;
      try {
        const result = await (serverFn
          ? runWithServerFunctionName(serverFn, () => next())
          : next());
        final = resolved();

        // Echo the route so the browser SDK can stamp url.template on its
        // client span: the client tree has no server-only routes, so this
        // header is its only exact source. Immutable headers keep theirs.
        if (final !== undefined) {
          try {
            result.response.headers.set("x-everr-route", final);
          } catch {}
        }

        const status = result.response.status;
        span.setAttribute("http.response.status_code", status);
        if (status >= 500) {
          captureError(
            new Error(`HTTP ${status}`),
            attrs(final, {
              "everr.error.source": "server.response",
              "http.response.status_code": status,
            }),
          );
        }
        return result;
      } catch (error) {
        final = resolved();
        captureError(
          error,
          attrs(final, {
            "everr.error.source": "server.request",
          }),
        );
        throw error;
      } finally {
        if (final !== undefined && final !== route) {
          span.updateName(`${method} ${final}`);
          span.setAttribute("http.route", final);
        }
        span.end();
      }
    },
  );
});
