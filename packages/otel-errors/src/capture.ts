import { type Attributes, diag } from "@opentelemetry/api";
import type { Client } from "./client.js";
import { PKG_NAME } from "./version.js";

// The one module-level slot. ErrorsInstrumentation.enable() writes it and
// disable() clears it, which is the same shape as the OTel API's own global
// registries (trace.getTracer, logs.getLogger): callers reach for capture
// without threading an instance through every call site.
let activeClient: Client | null = null;

export function setActiveClient(client: Client | null): void {
  activeClient = client;
}

export function getActiveClient(): Client | null {
  return activeClient;
}

export interface CaptureErrorOptions {
  handled?: boolean;
}

/**
 * Reports a handled error through the enabled instrumentation. A no-op (with
 * a diag warning) when no instrumentation is enabled, so a miswired app is
 * visible in diagnostics without throwing from a catch block.
 */
export function captureError(
  error: unknown,
  attributes?: Attributes,
  options?: CaptureErrorOptions,
): void {
  const handledAttr = attributes?.["error.handled"];
  const handled =
    options?.handled ?? (typeof handledAttr === "boolean" ? handledAttr : true);

  if (!activeClient) {
    diag.warn(
      `${PKG_NAME}: captureError called before the instrumentation was enabled; error dropped`,
    );
    return;
  }

  activeClient.capture({ error, mechanism: "manual", handled, attributes });
}
