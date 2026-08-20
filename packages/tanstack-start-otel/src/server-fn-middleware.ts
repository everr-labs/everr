import { createMiddleware } from "@tanstack/react-start";
import type { ServerFnTelemetryOptions } from "./server-fn-runtime";

/**
 * Global function middleware: one INTERNAL span per server-function call,
 * nested under the request's SERVER span.
 */
export const createServerFnTelemetryMiddleware = (
  options: ServerFnTelemetryOptions = {},
) =>
  createMiddleware({
    type: "function",
  }).server(async ({ next, serverFnMeta }) => {
    const [{ getRequest }, { instrumentServerFunction }] = await Promise.all([
      import("@tanstack/react-start/server"),
      import("./server-fn-runtime"),
    ]);

    return instrumentServerFunction(
      getRequest(),
      serverFnMeta,
      () => next(),
      options,
    );
  });
