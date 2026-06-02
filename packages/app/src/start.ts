import { createStart } from "@tanstack/react-start";
import { serverFnTelemetryMiddleware } from "@/telemetry/server-fn";

export const startInstance = createStart(() => ({
  functionMiddleware: [serverFnTelemetryMiddleware],
}));
