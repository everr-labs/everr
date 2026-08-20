import { trace } from "@opentelemetry/api";
import { createMiddleware } from "@tanstack/react-start";
import type { ServerFnTelemetryOptions } from "./server-fn-runtime.js";
import { instrumentServerFunction } from "./server-fn-runtime.js";

/**
 * Global function middleware: one INTERNAL span per server-function call,
 * nested under the request's SERVER span.
 */
export const createServerFnTelemetryMiddleware = ({
  isExpectedError,
  tracerName = "tanstack-start.server_fn",
}: ServerFnTelemetryOptions = {}) => {
  const tracer = trace.getTracer(tracerName);
  // `getRequest` reaches into the server half, so keep it off the client
  // bundle. Memoized: the import resolves once, not once per call.
  let serverModule: Promise<typeof import("@tanstack/react-start/server")>;

  return createMiddleware({
    type: "function",
  }).server(async ({ next, serverFnMeta }) => {
    serverModule ??= import("@tanstack/react-start/server");
    const { getRequest } = await serverModule;

    return instrumentServerFunction(() => next(), {
      tracer,
      request: getRequest(),
      serverFnMeta,
      isExpectedError,
    });
  });
};
