// The server entry, resolved by the package.json "node" condition so the
// same `@everr/otel-web` import works in both module graphs of a full-stack
// framework. On the server there is no everr-owned pipeline: the WebSDK attaches
// to the OpenTelemetry SDK the app has already registered (NodeSDK in
// instrumentation.ts) via the @opentelemetry/api globals. logger and
// captureError ride the app's LoggerProvider with the active context
// attached, so they land inside the app's traces, including traces
// propagated from the browser's network-request spans. No SDK registered
// means the API's built-in no-ops: silent and structurally inert, so keyless
// or SDK-less processes never issue a network request.
//
// Error capture delegates to @everr/otel-errors (normalization, redaction,
// rate limiting, and the recordException + setStatus(ERROR) span marking)
// instead of reimplementing it. That package owns one client per process, so
// an app that configures redaction for its own crash handlers covers these
// records too, and the ErrorsInstrumentation with its crash handlers stays
// the app's to register on its NodeSDK.
//
// The error path binds at module load, not in the WebSDK constructor: with
// nothing per-instance left to attach to, gating it would only make
// captureError silently no-op in a module graph that never constructs a
// WebSDK. logger keeps the constructor gate, because its emitter genuinely
// is per-instance, and shutdown() unbinds only that.
//
// This is the one module-load side effect in the package, so package.json's
// `sideEffects: false` is a half-truth for this entry. It stays: the flag
// lets a bundler drop the module only when nothing is imported from it, and
// a graph that imports nothing here has no captureError to bind for.

// The /core subpath is that package's runtime-neutral half: it keeps the
// instrumentation (and its @types/node requirement) out of this package's
// browser-lib tsc program, which deliberately has no node typings.
import { capture } from "@everr/otel-errors/core";
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
import type { ErrorsOptions } from "./instrumentations/errors/index.js";
import type { NetworkOptions } from "./instrumentations/network/index.js";
import type { PerformanceOptions } from "./instrumentations/performance/index.js";
import type { Instrumentation } from "./instrumentations/runtime.js";
import { logger } from "./logger.js";
import type { Persistence, UserTraits, WebSDKOptions } from "./types.js";
import { SDK_NAME, SDK_VERSION } from "./version.js";

// The one binding of the shared report surface to otel-errors, done at module
// load so server-side captureError works with no setup. Never unbound: the
// shared client outlives any WebSDK, so there is nothing to restore it to.
bindReport((error, mechanism, context) =>
  capture({ error, mechanism, context }),
);

export type { AttrValue } from "./emitter.js";
export { captureError } from "./errors.js";
export type {
  Instrumentation,
  InstrumentationContext,
} from "./instrumentations/runtime.js";
export type { Persistence, UserTraits, WebSDKOptions } from "./types.js";
export { logger };

/**
 * The server WebSDK: attaches to the app's registered OpenTelemetry SDK.
 * All options are accepted for shared-code compatibility but inert on the
 * server: resource, batching, export, and lifecycle belong to the app's SDK,
 * so `ingestKey` and `endpoint` are browser-only concerns and the instance's
 * `flush()` and `shutdown()` resolve immediately (force-flush before a
 * serverless freeze with the NodeSDK handle the app already holds).
 */
export class WebSDK {
  /** Resolves immediately; batching belongs to the app's SDK. */
  flush: () => Promise<void>;
  /** Unbinds logger from the app's SDK. Error capture stays live. */
  shutdown: () => Promise<void>;

  constructor(_options: WebSDKOptions) {
    // Resolved once: before a global provider registers this is a ProxyLogger
    // that starts delegating the moment the app's SDK lands.
    const otelLogger = logs.getLogger(SDK_NAME, SDK_VERSION);
    // The shared current.ts binding: logger samples it per call, here adapted
    // onto the app's LoggerProvider.
    const unbindEmit = bindEmit(emitVia(otelLogger));
    this.flush = async () => {};
    this.shutdown = async () => {
      unbindEmit();
    };
  }
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
  _get: ((url: string) => string | null | undefined) | null | undefined,
): void {}

// The built-in instrumentation factories, so shared code composing
// `new WebSDK({ instrumentations: [...] })` resolves in the server module
// graph too. The server WebSDK ignores instrumentations entirely, and these never touch the browser
// implementations: each returns an inert instrumentation that sets up nothing.
const inert: Instrumentation = () => {};

export type {
  ErrorMatcher,
  ErrorsOptions,
} from "./instrumentations/errors/index.js";
export type { NetworkOptions } from "./instrumentations/network/index.js";
export type {
  PageLoadOptions,
  PerformanceOptions,
  WebVitalName,
} from "./instrumentations/performance/index.js";
// sampled() is a generic wrapper, not a capture source: it works the same
// against the server's inert instrumentations as it does against browser ones.
export { sampled } from "./instrumentations/sampled.js";

/** Inert on the server; error capture belongs to the app's OTel SDK. */
export const errors = (_options?: ErrorsOptions): Instrumentation => inert;
/** Inert on the server; pageviews are a browser concept. */
export const pageviews = (): Instrumentation => inert;
/** Inert on the server; interactions are a browser concept. */
export const interactions = (): Instrumentation => inert;
/** Inert on the server; performance capture is a browser concept. */
export const performance = (_options?: PerformanceOptions): Instrumentation =>
  inert;
/** Inert on the server; the fetch patch is a browser concept. */
export const network = (_options?: NetworkOptions): Instrumentation => inert;

// Adapts the shared logger surface to the OTel Logs API: same Emit shape
// the browser pipeline uses. The severity text falls out of the API's
// numeric enum (5 DEBUG, 9 INFO, 13 WARN, 17 ERROR).
const emitVia =
  (otelLogger: Logger): Emit =>
  (_eventName, attributes, severityNumber, body) => {
    otelLogger.emit({
      severityNumber,
      // Indexing with the enum: no everr emit path omits the severity, and
      // an out-of-enum number safely yields undefined.
      severityText: SeverityNumber[severityNumber as number],
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
