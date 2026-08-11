import type { Attributes } from "@opentelemetry/api";
import { diag } from "@opentelemetry/api";
import { type Logger, logs } from "@opentelemetry/api-logs";
import { type CaptureInput, Client } from "./client.js";
import { resolveFlushable } from "./providers.js";
import type { ClientOptions } from "./types.js";
import { PKG_NAME } from "./version.js";

// These functions give access to the one error client of the process. The
// `Client` class holds that client, and `Client.shared()` gives it. All the
// code that reports an error uses these functions: `captureError`, the crash
// handlers of the ErrorsInstrumentation, and the server entry of
// @everr/otel-web. The code builds the client at the first call. Thus the
// capture operates before the configuration, and no caller must do a setup
// step first.
//
// One client has one configuration, and this is the intention. An app that
// installs `beforeSend` for its crash handlers gets that hook on all the other
// error paths also.
//
// This module keeps only the two flags below. They control the one warning
// from captureError. That warning is part of the captureError function, and it
// is not part of the capture path. Thus the flags are not in the client.
let providerSeen = false;
let warnedNoProvider = false;

/**
 * Applies the options to the shared client. The function merges the options. A
 * key that is not present keeps its current value. Thus two callers that set
 * different fields do not change the fields of each other. For one field, the
 * value from the last caller stays, and the client gives no warning.
 */
export function configure(options: ClientOptions): void {
  Client.shared().configure(options);
}

/**
 * Reports one error through the shared client. This function is below
 * `captureError`. Use it in an SDK that reports its own mechanisms, for
 * example a React error boundary or a browser `onerror` handler. Do not use it
 * for a manual capture.
 */
export function capture(input: CaptureInput): void {
  Client.shared().capture(input);
}

/** Connects the shared client to the logger of a provider, not to the global one. */
export function setLogger(logger: Logger): void {
  Client.shared().setLogger(logger);
}

/**
 * For tests only. Sets the client back to its initial condition. This is the
 * only hook, and it changes the client and the warning flags of this module.
 * Thus a test does not have to know that two modules keep this data.
 */
export function resetSharedClient(): void {
  Client.reset();
  providerSeen = false;
  warnedNoProvider = false;
}

/**
 * Reports an error as an OTel exception log record. The context attributes are
 * optional. This function operates without an ErrorsInstrumentation and
 * without a call to `configure`. The records go through the global logger
 * provider. The code finds that provider when it sends a record, after an SDK
 * registers one.
 */
export function captureError(error: unknown, context?: Attributes): void {
  // The code discards the records that it sends before an SDK registers. It
  // does not keep them in a buffer. Thus it gives a warning one time. A
  // provider that registers does not unregister. Thus the first successful
  // test stays true, and each subsequent call does only one boolean test.
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

  Client.shared().capture({
    error,
    mechanism: "manual",
    context,
  });
}
