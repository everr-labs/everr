// The server entry, resolved by the package.json "node" condition so the
// same `@everr/otel-web` import works in both module graphs of a full-stack
// framework. On the server there is no everr-owned pipeline: init() attaches
// to the OpenTelemetry SDK the app has already registered (NodeSDK in
// instrumentation.ts) via the @opentelemetry/api globals. logger and
// captureError ride the app's LoggerProvider with the active context
// attached, so they land inside the app's traces, including traces
// propagated from the browser's network-request spans. No SDK registered
// means the API's built-in no-ops: silent and structurally inert, so keyless
// or SDK-less processes never issue a network request.
//
// Error capture delegates to @everr/auto-otel-errors' core Client
// (normalization, scrubbing, rate limiting, and the recordException +
// setStatus(ERROR) span marking) instead of reimplementing it, but
// constructs its own instance: the package-level auto-otel-errors client,
// and with it the process crash handlers, stay the app's to init in the
// server entrypoint.

// The Client class is runtime-parameterized and identical across that
// package's entries; the /browser subpath keeps node-globals (and its
// @types/node requirement) out of this package's browser-lib tsc program.
import { Client } from "@everr/auto-otel-errors/browser";
import { context } from "@opentelemetry/api";
import { type LogAttributes, logs } from "@opentelemetry/api-logs";
import type { AttrValue, Emit } from "./emitter.js";
import { logger, startLogger } from "./logger.js";
import type { EverrClient, InitOptions, UserTraits } from "./types.js";

declare const __PACKAGE_VERSION__: string | undefined;
const SDK_VERSION =
  typeof __PACKAGE_VERSION__ === "string" ? __PACKAGE_VERSION__ : "0.0.0-dev";
const SDK_NAME = "@everr/otel-web";

export { setRouteResolver } from "./route.js";
export type {
  CaptureSignal,
  EverrClient,
  InitOptions,
  Persistence,
  UserTraits,
} from "./types.js";
export { logger };

// Pre-init misuse is visible (never throws); shutdown() swaps in null and
// the surface goes silent by design, mirroring the browser logger contract.
let errors: Client | null | undefined;

/**
 * Attaches to the app's registered OpenTelemetry SDK. All options are
 * accepted for shared-code compatibility but inert on the server: resource,
 * batching, export, and lifecycle belong to the app's SDK, so `ingestKey` and
 * `endpoint` are browser-only concerns and the returned handle's `flush()`
 * and `shutdown()` resolve immediately (force-flush before a serverless
 * freeze with the NodeSDK handle the app already holds).
 */
export function init(_options: InitOptions): EverrClient {
  errors = new Client({}, "node", []);
  const stopLogger = startLogger(emitViaOtel);
  return {
    flush: async () => {},
    shutdown: async () => {
      stopLogger();
      errors = null;
    },
  };
}

/** Reports a handled error, with optional extra attributes. */
export function captureError(
  error: unknown,
  attributes?: Record<string, string | number | boolean>,
  options?: { handled?: boolean },
): void {
  if (errors === undefined) {
    console.warn("[everr] SDK not initialized");
    return;
  }
  errors?.capture({
    error,
    mechanism: "manual",
    handled: options?.handled ?? true,
    attributes,
  });
}

// Identity is browser-bound (visitor id, session, user traits on the
// envelope); per-process identity on server records would leak users across
// requests, so on the server these are honest no-ops that never throw from
// shared code.
/** No-op on the server; identity is a browser concept. */
export function identify(_userId: string, _traits?: UserTraits): void {}

/** No-op on the server; identity is a browser concept. */
export function revoke(): void {}

const SEVERITY_TEXT: Record<number, string> = {
  5: "DEBUG",
  9: "INFO",
  13: "WARN",
  17: "ERROR",
};

// Adapts the shared logger surface to the OTel Logs API: same Emit shape
// the browser pipeline uses, resolved to a Logger per call so a provider
// registered after init() still receives records.
const emitViaOtel: Emit = (_eventName, attributes, severityNumber, body) => {
  logs.getLogger(SDK_NAME, SDK_VERSION).emit({
    severityNumber,
    severityText: severityNumber ? SEVERITY_TEXT[severityNumber] : undefined,
    body,
    attributes: cleanAttributes(attributes),
    context: context.active(),
  });
};

function cleanAttributes(
  attributes?: Record<string, AttrValue | null | undefined>,
): LogAttributes | undefined {
  if (!attributes) return undefined;
  const out: LogAttributes = {};
  for (const [key, value] of Object.entries(attributes)) {
    if (value != null) out[key] = value;
  }
  return out;
}
