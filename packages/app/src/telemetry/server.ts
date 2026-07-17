import type { Attributes, TextMapGetter } from "@opentelemetry/api";
import { context, propagation } from "@opentelemetry/api";
import { captureError, getTelemetryTracer, SpanKind } from "./node";
import { parameterizeTelemetryPath } from "./paths";

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
  const route = parameterizeTelemetryPath(new URL(request.url).pathname);
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
    `${method} ${route}`,
    {
      attributes: requestAttributes(request, route, method),
      kind: SpanKind.SERVER,
    },
    parentContext,
    async (span) => {
      try {
        const response = await run();

        span.setAttribute("http.response.status_code", response.status);
        if (response.status >= 500) {
          captureError(new Error(`HTTP ${response.status}`), {
            "error.handled": false,
            "error.source": "server.response",
            "http.request.method": method,
            "http.response.status_code": response.status,
            "http.route": route,
            "url.path": route,
          });
        }

        return response;
      } catch (error) {
        captureError(error, {
          "error.handled": false,
          "error.source": "server.fetch",
          "http.request.method": method,
          "http.route": route,
          "url.path": route,
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
  route: string,
  method: string,
): Attributes {
  return {
    "http.request.method": method,
    "http.route": route,
    "url.path": route,
    "url.scheme": new URL(request.url).protocol.replace(/:$/, ""),
  };
}
