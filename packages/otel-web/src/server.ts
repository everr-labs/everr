// The server entry. The "node" condition in package.json selects it. Thus the
// same `@everr/otel-web` import operates in the two module graphs of a
// full-stack framework.
//
// On the server this package has no pipeline. The WebSDK connects to the
// OpenTelemetry SDK that the app registered before, which is the NodeSDK in
// instrumentation.ts. It uses the globals of @opentelemetry/api. The logger and
// captureError use the LoggerProvider of the app with the active context. Thus
// their records go into the traces of the app. This includes a trace that comes
// from a network-request span in the browser. If the app registers no SDK, the
// API supplies functions that do nothing. They give no warning and make no
// structure. Thus a process without a key or without an SDK makes no network
// request.
//
// The error capture uses @everr/otel-errors, and this module does not write
// that code again. That package makes the error regular and it marks the span
// with recordException and setStatus(ERROR). It has one client for each
// process. Thus an app that installs the beforeSend of that package for its own
// crash handlers also covers these records. The app registers the
// ErrorsInstrumentation and its crash handlers on its NodeSDK.
//
// The beforeSend of the WebSDK does not operate on this path, because an error
// on the server does not go through the emitter of this package. The two hooks
// have the same name and they are in two packages. Refer to the README.
//
// The error path needs no connection step. This entry exports its own
// captureError, and the react entry imports it through the package name. The
// "." export in package.json gives this entry to the react module graph of
// the server, and thus no code changes a binding at run time.
//
// The logger keeps its connection in the constructor, because its emitter
// belongs to one instance. The shutdown() function disconnects only the
// logger.

// The /core subpath is the part of that package for all runtimes. It keeps the
// instrumentation and its @types/node requirement out of the browser tsc
// program of this package. That program has no Node types, and this is
// correct.
import { capture } from "@everr/otel-errors/core";
import { context } from "@opentelemetry/api";
import {
  type LogAttributes,
  type Logger,
  logs,
  SeverityNumber,
} from "@opentelemetry/api-logs";
import { bindEmit } from "./emit.js";
import {
  type AttrValue,
  type BeforeSend,
  createBeforeSendGuard,
  type Emit,
} from "./emitter.js";
import type { ErrorContext } from "./errors.js";
import type { ErrorsOptions } from "./instrumentations/errors/index.js";
import type { NetworkOptions } from "./instrumentations/network/index.js";
import type { PerformanceOptions } from "./instrumentations/performance/index.js";
import type { Instrumentation } from "./instrumentations/runtime.js";
import { logger } from "./logger.js";
import type { Persistence, UserTraits, WebSDKOptions } from "./types.js";
import { SDK_NAME, SDK_VERSION } from "./version.js";

export type { AttrValue } from "./emitter.js";
export type { ErrorContext } from "./errors.js";

/**
 * Reports an error. The context attributes are optional. A caller that is not
 * manual puts "everr.error.mechanism" in the context; without that attribute
 * the report is manual. This needs no WebSDK on the server. The record goes
 * through @everr/otel-errors to the LoggerProvider of the app with the active
 * context.
 */
export function captureError(error: unknown, context?: ErrorContext): void {
  capture({
    error,
    context,
  });
}
export type {
  Instrumentation,
  InstrumentationContext,
} from "./instrumentations/runtime.js";
export type { Persistence, UserTraits, WebSDKOptions } from "./types.js";
export { logger };

/**
 * The WebSDK for the server. It connects to the OpenTelemetry SDK that the app
 * registered.
 *
 * It accepts all the options, and thus the same code operates in the browser
 * and on the server. But the options have no function on the server. The SDK of
 * the app controls the resource, the batches, the export, and the lifecycle.
 * Thus `ingestKey` and `endpoint` are for the browser only, and the `flush()`
 * and `shutdown()` functions of the instance complete immediately. To send the
 * records before a serverless function stops, use the NodeSDK that the app
 * holds.
 */
export class WebSDK {
  /** Completes immediately. The SDK of the app controls the batches. */
  flush: () => Promise<void>;
  /** Disconnects the logger from the SDK of the app. The error capture
   * continues to operate. */
  shutdown: () => Promise<void>;

  constructor(options: WebSDKOptions) {
    // The code finds this one time. Before a global provider registers, this is
    // a ProxyLogger. That proxy sends the records to the true logger when the
    // SDK of the app registers.
    const otelLogger = logs.getLogger(SDK_NAME, SDK_VERSION);
    // The shared binding in current.ts. The logger reads it at each call. Here
    // the code connects it to the LoggerProvider of the app.
    const unbindEmit = bindEmit(emitVia(otelLogger, options.beforeSend));
    this.flush = async () => {};
    this.shutdown = async () => {
      unbindEmit();
    };
  }
}

// The identity and the route belong to the browser. The visitor id, the
// session, and the route pattern are all in the envelope of one tab. An
// identity for each process on the server sends the data of one user into the
// requests of a different user. Thus on the server these functions do nothing,
// and they throw no error when the shared code calls them.
/** Does nothing on the server. The identity belongs to the browser. */
export function identify(_userId: string, _traits?: UserTraits): void {}

/** Does nothing on the server. The identity belongs to the browser. */
export function revoke(): void {}

/** Does nothing on the server. The envelope of the browser carries the ambient
 * context. */
export function setAttributes(
  _attributes: Record<string, AttrValue | null>,
): void {}

/** Does nothing on the server. The persistence belongs to the browser. */
export function setPersistence(_persistence: Persistence | undefined): void {}

/** Does nothing on the server. The envelope of the browser carries the route
 * patterns. */
export function setRouteResolver(
  _get: ((url: string) => string | null | undefined) | null | undefined,
): void {}

// The functions that make the built-in instrumentations. Thus shared code that
// writes `new WebSDK({ instrumentations: [...] })` also operates in the server
// module graph. The WebSDK for the server ignores all the instrumentations.
// These functions use none of the browser code: each one returns an
// instrumentation that does nothing.
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
// The sampled() function contains a different instrumentation, and it is not a
// source of the capture. It operates in the same way with the instrumentations
// of the server that do nothing and with the instrumentations of the browser.
export { sampled } from "./instrumentations/sampled.js";

/** Does nothing on the server. The OTel SDK of the app captures the errors. */
export const errors = (_options?: ErrorsOptions): Instrumentation => inert;
/** Does nothing on the server. The pageviews belong to the browser. */
export const pageviews = (): Instrumentation => inert;
/** Does nothing on the server. The interactions belong to the browser. */
export const interactions = (): Instrumentation => inert;
/** Does nothing on the server. The performance capture belongs to the browser. */
export const performance = (_options?: PerformanceOptions): Instrumentation =>
  inert;
/** Does nothing on the server. The change to fetch belongs to the browser. */
export const network = (_options?: NetworkOptions): Instrumentation => inert;

// Connects the shared logger functions to the OTel Logs API. It uses the same
// Emit structure as the pipeline of the browser. The severity text comes from
// the numeric enum of the API: 5 is DEBUG, 9 is INFO, 13 is WARN, and 17 is
// ERROR.
// The hook of the host operates here also. A record from an isomorphic
// `logger` call goes through the same hook in the two module graphs, and the
// rule on an error comes from the same guard as the browser. Only the log
// condition can occur: the server entry has no span pipeline. The eventName
// goes to the hook, but this entry does not send it, and thus a hook that
// changes it has no result on the server.
const emitVia = (
  otelLogger: Logger,
  beforeSend: BeforeSend | undefined,
): Emit => {
  const applyBeforeSend = createBeforeSendGuard(beforeSend);
  const write = (
    severityNumber: number,
    body: string,
    attributes: Record<string, AttrValue | null | undefined> | undefined,
  ): void =>
    otelLogger.emit({
      severityNumber,
      // The code reads the enum with this index. Each emit path in this
      // package sets the severity. If the number is not in the enum, the
      // result is undefined, and this causes no error.
      severityText: SeverityNumber[severityNumber],
      body,
      attributes: cleanAttributes(attributes),
      context: context.active(),
    });

  return (eventName, attributes, severityNumber = 9, body = eventName) => {
    // Without a hook the code sends the attributes of the caller directly. The
    // copy below exists only to keep a hook that changes the item away from
    // the object of the caller.
    if (!beforeSend) {
      write(severityNumber, body, attributes);
      return;
    }
    const item = applyBeforeSend({
      kind: "log",
      eventName,
      attributes: { ...attributes },
      severityNumber,
      body,
    });
    if (item?.kind !== "log") return;
    write(item.severityNumber, item.body, item.attributes);
  };
};

// This function ignores a value of null and a value of undefined, the same as
// the toKeyValues function of the emitter. Thus a caller can write an optional
// attribute as a usual property.
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
