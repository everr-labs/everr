import type { Attributes, TextMapGetter } from "@opentelemetry/api";
import { context, propagation } from "@opentelemetry/api";
import { captureError, getTelemetryTracer, SpanKind } from "./node";
import { serverRouteTemplate } from "./server-router";

const tracer = getTelemetryTracer();

// Read W3C headers off a Fetch `Headers` object for context extraction.
const headersGetter: TextMapGetter<Headers> = {
  keys: (carrier) => [...carrier.keys()],
  get: (carrier, key) => carrier.get(key) ?? undefined,
};

export async function instrumentServerFetch(
  request: Request,
  run: () => Response | Promise<Response>,
) {
  const pathname = new URL(request.url).pathname;
  const route = serverRouteTemplate(pathname);
  const method = request.method.toUpperCase();

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
      try {
        const response = await run();

        // Echo the derived route so the browser SDK can stamp url.template on
        // its client span: the client route tree has no server-only routes, so
        // this header is the browser's only exact source for API templates.
        if (route !== undefined) {
          try {
            response.headers.set("x-everr-route", route);
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
            ...(route === undefined ? {} : { "http.route": route }),
            "url.path": pathname,
          });
        }

        return response;
      } catch (error) {
        captureError(error, {
          "everr.error.source": "server.fetch",
          "http.request.method": method,
          ...(route === undefined ? {} : { "http.route": route }),
          "url.path": pathname,
        });
        throw error;
      } finally {
        span.end();
      }
    },
  );
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
