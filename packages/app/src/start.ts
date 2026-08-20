import { createCsrfMiddleware, createStart } from "@tanstack/react-start";
import { serverFnTelemetryMiddleware } from "@/telemetry/server-fn";

// Start only auto-installs CSRF protection when there is no custom start.ts.
// Since we have one, register it ourselves. Scoped to server functions so the
// API routes (CLI apply, MCP, webhooks) keep accepting cross-origin callers.
const csrfMiddleware = createCsrfMiddleware({
  filter: (ctx) => ctx.handlerType === "serverFn",
});

export const startInstance = createStart(() => ({
  requestMiddleware: [csrfMiddleware],
  functionMiddleware: [serverFnTelemetryMiddleware],
}));
