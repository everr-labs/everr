import { type Attributes, diag } from "@opentelemetry/api";
import { logs } from "@opentelemetry/api-logs";
import { Client } from "./client.js";
import { resolveFlushable } from "./providers.js";
import { PKG_NAME } from "./version.js";

// The one module-level slot, owned by capture rather than the
// instrumentation: captureError always has a client to report through. The
// default one is built lazily with default options against the global logger
// registry; an ErrorsInstrumentation adopts the slot to apply user options
// (scrubbing, rate limits) to manual captures too.
let sharedClient: Client | null = null;
let adoptedBy: object | null = null;
let providerSeen = false;
let warnedNoProvider = false;

export function getSharedClient(): Client {
  if (!sharedClient) {
    sharedClient = new Client();
  }
  return sharedClient;
}

/**
 * Points captureError at an instrumentation-configured client. Two
 * instrumentations is a misconfiguration (both capture every fatal error), so
 * a change of owner warns rather than silently redirecting manual reports;
 * the same owner re-adopting (setConfig) is fine.
 */
export function adoptSharedClient(client: Client, owner: object): void {
  if (adoptedBy && adoptedBy !== owner) {
    diag.warn(
      `${PKG_NAME}: a second ErrorsInstrumentation was constructed; captureError now reports through it`,
    );
  }
  sharedClient = client;
  adoptedBy = owner;
}

/** Test-only: restores the lazy default-client state. */
export function resetSharedClient(): void {
  sharedClient = null;
  adoptedBy = null;
  providerSeen = false;
  warnedNoProvider = false;
}

export interface CaptureErrorOptions {
  handled?: boolean;
}

/**
 * Reports a handled error as an OTel exception log record. Works without an
 * ErrorsInstrumentation: records go through the global logger provider, which
 * resolves at emit time once an SDK registers. When an instrumentation is
 * constructed, its options (scrubbing, rate limits) apply here too.
 */
export function captureError(
  error: unknown,
  attributes?: Attributes,
  options?: CaptureErrorOptions,
): void {
  const handledAttr = attributes?.["error.handled"];
  const handled =
    options?.handled ?? (typeof handledAttr === "boolean" ? handledAttr : true);

  // Records emitted before an SDK registers are dropped, not buffered, so
  // say so once. A registered provider never unregisters, so the successful
  // probe latches and the steady-state cost is one boolean test.
  if (!providerSeen && !warnedNoProvider) {
    if (resolveFlushable(logs.getLoggerProvider())) {
      providerSeen = true;
    } else {
      warnedNoProvider = true;
      diag.warn(
        `${PKG_NAME}: captureError emitted before a LoggerProvider was registered; records are lost until an SDK starts.`,
      );
    }
  }

  getSharedClient().capture({
    error,
    mechanism: "manual",
    handled,
    attributes,
  });
}
