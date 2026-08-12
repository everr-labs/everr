// The captureError function reports an error manually. After the code
// constructs a WebSDK, the emitter of the SDK sends the report. Before that,
// captureError gives a warning and causes no error. The identify() and revoke()
// functions operate in the same way, and they become active when a browser
// WebSDK exists. The `persistence` option controls the life of their ids.
//
// The WebSDK operates in the two module graphs of a full-stack framework. The
// browser gets all the signals. The server gets the logger and captureError on
// the same pipeline. The exports for React are in the separate
// `@everr/otel-web/react` entry.

export { WebSDK } from "./client.js";
export { captureError } from "./errors.js";
export {
  type ErrorMatcher,
  type ErrorsOptions,
  errors,
} from "./instrumentations/errors/index.js";
export { interactions } from "./instrumentations/interactions/index.js";
export {
  type NetworkOptions,
  network,
} from "./instrumentations/network/index.js";
export {
  type PageLoadOptions,
  pageLoad,
} from "./instrumentations/pageload/index.js";
export { pageviews } from "./instrumentations/pageviews/index.js";
export {
  type PerformanceOptions,
  performance,
  type WebVitalName,
} from "./instrumentations/performance/index.js";
export type {
  Instrumentation,
  InstrumentationContext,
  PageContext,
} from "./instrumentations/runtime.js";
export { sampled } from "./instrumentations/sampled.js";
export { logger } from "./logger.js";
export type {
  AttrValue,
  BeforeSend,
  LogEvent,
  SendEvent,
  SpanEvent,
} from "./pipeline/emitter.js";
export { setAttributes } from "./state/attributes.js";
export {
  type RouteResolvers,
  type RouteTemplateResolver,
  setRouteResolver,
} from "./state/route.js";
export {
  clearIdentity,
  identify,
  revoke,
  setPersistence,
} from "./state/session.js";
export type { Persistence, UserTraits, WebSDKOptions } from "./types.js";
