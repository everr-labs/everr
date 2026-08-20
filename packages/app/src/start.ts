import { createStart } from "@tanstack/react-start";
import { requestTelemetryMiddleware } from "@/telemetry/server";
import { serverFnTelemetryMiddleware } from "@/telemetry/server-fn";

export const startInstance = createStart(() => ({
  // Loaders depend on browser state (localStorage, auth cookies via the
  // client); the app ships as an SPA shell, so routes never render on the
  // server.
  defaultSsr: false,
  requestMiddleware: [requestTelemetryMiddleware],
  functionMiddleware: [serverFnTelemetryMiddleware],
}));
