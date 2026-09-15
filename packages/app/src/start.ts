import {
  createRequestTelemetryMiddleware,
  createServerFnTelemetryMiddleware,
  type RouterLike,
} from "@everr/tanstack-start-otel";
import { createMiddleware, createStart } from "@tanstack/react-start";
import { getRouter } from "@/router";
import { isExpectedServerFunctionError } from "@/telemetry/expected-errors";
import { withTelemetryIdentityScope } from "@/telemetry/identity";

export const startInstance = createStart(() => ({
  // Loaders depend on browser state (localStorage, auth cookies via the
  // client); the app ships as an SPA shell, so routes never render on the
  // server.
  defaultSsr: false,
  requestMiddleware: [
    createMiddleware({ type: "request" }).server(({ next }) =>
      withTelemetryIdentityScope(() => next(), null),
    ),
    createRequestTelemetryMiddleware({
      // Annotated so the router type does not flow back into this module:
      // routeTree.gen binds Register to getRouter, which would make the start
      // instance and the router mutually inferred.
      router: (): RouterLike => getRouter(),
      tracerName: "everr-app.server",
    }),
  ],
  functionMiddleware: [
    createServerFnTelemetryMiddleware({
      isExpectedError: isExpectedServerFunctionError,
      tracerName: "everr-app.server_fn",
    }),
  ],
}));
