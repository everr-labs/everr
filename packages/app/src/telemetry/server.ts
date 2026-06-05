import type { Attributes } from "@opentelemetry/api";
import { getTelemetryTracer, recordTelemetryError, SpanKind } from "./node";
import { parameterizeTelemetryPath } from "./paths";

const tracer = getTelemetryTracer();

export async function instrumentServerFetch(
  request: Request,
  run: () => Response | Promise<Response>,
) {
  const route = parameterizeTelemetryPath(new URL(request.url).pathname);
  const method = request.method.toUpperCase();

  return tracer.startActiveSpan(
    `${method} ${route}`,
    {
      attributes: requestAttributes(request, route, method),
      kind: SpanKind.SERVER,
    },
    async (span) => {
      try {
        const response = await run();

        span.setAttribute("http.response.status_code", response.status);
        if (response.status >= 500) {
          recordTelemetryError(new Error(`HTTP ${response.status}`), {
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
        recordTelemetryError(error, {
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
