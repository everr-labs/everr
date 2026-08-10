// The runtime-neutral entry: the capture path with no Node and no
// @opentelemetry/instrumentation dependency, so a browser-targeted tsc
// program can consume it without pulling @types/node into its globals.
// @everr/otel-web's server entry is its consumer.
// `capture` is exported here and not from ./node: it is the surface for SDKs
// built on this package, which report their own mechanisms. An application
// wants `captureError`.
export { capture, configure, setLogger } from "./capture.js";
export type { CaptureInput } from "./client.js";
export { type NormalizedError, normalizeError } from "./normalize.js";
export { RateLimiter } from "./rate-limit.js";
export {
  type CollectBehavior,
  DEFAULT_REDACT_PATTERNS,
  redactAttributes,
  redactString,
  stripUrlQueryAndFragment,
} from "./redact.js";
export type {
  ClientOptions,
  ErrorEvent,
  ErrorSeverity,
  Mechanism,
} from "./types.js";
export { PKG_NAME, PKG_VERSION } from "./version.js";
