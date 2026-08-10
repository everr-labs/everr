import type { Attributes } from "@opentelemetry/api";
import { diag } from "@opentelemetry/api";
import { type Logger, logs } from "@opentelemetry/api-logs";
import { type CaptureInput, Client } from "./client.js";
import { resolveFlushable } from "./providers.js";
import type { ClientOptions } from "./types.js";
import { PKG_NAME } from "./version.js";

// The process's one error client. Everything that reports an error goes
// through it: `captureError`, the ErrorsInstrumentation's crash handlers, and
// @everr/otel-web's server entry. It is built lazily against the global
// logger registry, so capture works before anything configures it and no
// caller has to sequence a setup step.
//
// One client means one configuration, which is the point: redaction an app
// sets for its crash handlers necessarily covers every other error path too.
let instance: Client | null = null;
let providerSeen = false;
let warnedNoProvider = false;

function sharedClient(): Client {
  if (!instance) {
    instance = new Client();
  }
  return instance;
}

/**
 * Applies options to the shared client. Merges: an absent key keeps its
 * current value, so two callers configuring different fields do not overwrite
 * each other, and the last writer of any one field wins silently.
 */
export function configure(options: ClientOptions): void {
  sharedClient().configure(options);
}

/**
 * Reports one error through the shared client. The lower-level surface behind
 * `captureError`, for SDKs that report their own mechanisms (a React error
 * boundary, a browser `onerror` handler) rather than manual captures.
 */
export function capture(input: CaptureInput): void {
  sharedClient().capture(input);
}

/** Binds the shared client to a provider's logger instead of the global one. */
export function setLogger(logger: Logger): void {
  sharedClient().setLogger(logger);
}

/** Test-only: restores the lazy default-client state. */
export function resetSharedClient(): void {
  instance = null;
  providerSeen = false;
  warnedNoProvider = false;
}

/**
 * Reports an error as an OTel exception log record, with optional context
 * attributes. Works without an ErrorsInstrumentation and without a
 * `configure` call: records go through the global logger provider, which
 * resolves at emit time once an SDK registers.
 */
export function captureError(error: unknown, context?: Attributes): void {
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

  sharedClient().capture({
    error,
    mechanism: "manual",
    context,
  });
}
