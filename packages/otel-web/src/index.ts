// captureError is the manual reporting surface for handled errors; it flows
// through the SDK's emitter once a WebSDK has been constructed and safely
// warns before that. identify()/revoke() work the same way, live once a
// browser WebSDK exists; the `persistence` option decides how long their
// ids live. WebSDK works in both module graphs of a full-stack framework:
// the browser gets the full signal set, the server gets logger and
// captureError on the same pipeline. React-specific exports live in the dedicated
// `@everr/otel-web/react` entry.

export { setAttributes } from "./attributes.js";
export { WebSDK } from "./client.js";
export type { AttrValue } from "./emitter.js";
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
export { pageviews } from "./instrumentations/pageviews/index.js";
export {
  type PageLoadOptions,
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
export { setRouteResolver } from "./route.js";
export { identify, revoke, setPersistence } from "./session.js";
export type { Persistence, UserTraits, WebSDKOptions } from "./types.js";
