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
import {
  type LogAttributes,
  type Logger,
  logs,
  SeverityNumber,
} from "@opentelemetry/api-logs";
import { bindEmit } from "./current.js";
import type { AttrValue, Emit } from "./emitter.js";
import { bindReport } from "./errors.js";
import { logger } from "./logger.js";
import type { ErrorsOptions } from "./plugins/errors/index.js";
import type { NetworkOptions } from "./plugins/network/index.js";
import type { Plugin } from "./plugins/runtime.js";
import type {
  EverrClient,
  InitOptions,
  Persistence,
  UserTraits,
} from "./types.js";
import { SDK_NAME, SDK_VERSION } from "./version.js";

// captureError is the same live-binding surface the browser uses (one
// state machine: warn before init, silent after shutdown); init() below
// swaps in the auto-otel-errors adapter.
export type { AttrValue } from "./emitter.js";
export { captureError } from "./errors.js";
export type { Plugin, PluginContext } from "./plugins/runtime.js";
export type {
  EverrClient,
  InitOptions,
  Persistence,
  UserTraits,
} from "./types.js";
export { logger };

/**
 * Attaches to the app's registered OpenTelemetry SDK. All options are
 * accepted for shared-code compatibility but inert on the server: resource,
 * batching, export, and lifecycle belong to the app's SDK, so `ingestKey` and
 * `endpoint` are browser-only concerns and the returned handle's `flush()`
 * and `shutdown()` resolve immediately (force-flush before a serverless
 * freeze with the NodeSDK handle the app already holds).
 */
export function init(_options: InitOptions): EverrClient {
  // Resolved once: before a global provider registers this is a ProxyLogger
  // that starts delegating the moment the app's SDK lands.
  const otelLogger = logs.getLogger(SDK_NAME, SDK_VERSION);
  const errors = new Client({}, "node", []);
  // The shared current.ts binding: logger samples it per call, here adapted
  // onto the app's LoggerProvider.
  const unbindEmit = bindEmit(emitVia(otelLogger));
  const stopReporting = bindReport((error, mechanism, handled, extra) =>
    errors.capture({ error, mechanism, handled, attributes: extra }),
  );
  return {
    flush: async () => {},
    shutdown: async () => {
      unbindEmit();
      stopReporting();
    },
  };
}

// Identity and route resolution are browser-bound (visitor id, session, and
// the route pattern all live on the per-tab envelope); per-process identity
// on server records would leak users across requests, so on the server
// these are honest no-ops that never throw from shared code.
/** No-op on the server; identity is a browser concept. */
export function identify(_userId: string, _traits?: UserTraits): void {}

/** No-op on the server; identity is a browser concept. */
export function revoke(): void {}

/** No-op on the server; ambient context rides the browser envelope. */
export function setAttributes(
  _attributes: Record<string, AttrValue | null>,
): void {}

/** No-op on the server; persistence is a browser concept. */
export function setPersistence(_persistence: Persistence | undefined): void {}

/** No-op on the server; route patterns ride the browser envelope. */
export function setRouteResolver(
  _get: (() => string | null | undefined) | null | undefined,
): void {}

// The built-in plugin factories, so shared code composing
// `init({ plugins: [...] })` resolves in the server module graph too. The
// server init ignores plugins entirely, and these never touch the browser
// implementations: each returns an inert plugin that sets up nothing.
const inert: Plugin = () => {};

export type {
  ErrorMatcher,
  ErrorsOptions,
} from "./plugins/errors/index.js";
export type { NetworkOptions } from "./plugins/network/index.js";

/** Inert on the server; error capture belongs to the app's OTel SDK. */
export const errors = (_options?: ErrorsOptions): Plugin => inert;
/** Inert on the server; pageviews are a browser concept. */
export const pageviews = (): Plugin => inert;
/** Inert on the server; interactions are a browser concept. */
export const interactions = (): Plugin => inert;
/** Inert on the server; performance capture is a browser concept. */
export const performance = (): Plugin => inert;
/** Inert on the server; the fetch patch is a browser concept. */
export const network = (_options?: NetworkOptions): Plugin => inert;

// Adapts the shared logger surface to the OTel Logs API: same Emit shape
// the browser pipeline uses. The severity text falls out of the API's
// numeric enum (5 DEBUG, 9 INFO, 13 WARN, 17 ERROR).
const emitVia =
  (otelLogger: Logger): Emit =>
  (_eventName, attributes, severityNumber, body) => {
    otelLogger.emit({
      severityNumber,
      severityText: severityNumber ? SeverityNumber[severityNumber] : undefined,
      body,
      attributes: cleanAttributes(attributes),
      context: context.active(),
    });
  };

// Same skip-nullish convention as the emitter's toKeyValues, so callers
// write optional attributes plainly.
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
