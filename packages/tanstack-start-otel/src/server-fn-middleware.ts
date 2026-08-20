import { trace } from "@opentelemetry/api";
import { createMiddleware } from "@tanstack/react-start";
import type { ServerFnTelemetryOptions } from "./server-fn-runtime.js";
import { instrumentServerFunction } from "./server-fn-runtime.js";

type GetRequest = typeof import("@tanstack/react-start/server").getRequest;

/**
 * Global function middleware: one INTERNAL span per server-function call,
 * nested under the request's SERVER span.
 */
export const createServerFnTelemetryMiddleware = ({
  isExpectedError,
  tracerName = "tanstack-start.server_fn",
}: ServerFnTelemetryOptions = {}) => {
  const tracer = trace.getTracer(tracerName);

  // `getRequest` reaches into the server half, so it stays out of the client
  // bundle behind a dynamic import. Only the first call awaits it: once the
  // handle is stored, later calls read it synchronously and never yield.
  let getRequest: GetRequest | undefined;
  let loading: Promise<GetRequest> | undefined;

  return createMiddleware({
    type: "function",
  }).server(({ next, serverFnMeta }) => {
    const start = (get: GetRequest) =>
      instrumentServerFunction(() => next(), {
        tracer,
        request: get(),
        serverFnMeta,
        isExpectedError,
      });

    if (getRequest) return start(getRequest);

    loading ??= import("@tanstack/react-start/server").then(
      (m) => (getRequest = m.getRequest),
    );
    return loading.then(start);
  });
};
