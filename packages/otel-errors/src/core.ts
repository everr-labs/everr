// The runtime-neutral entry: the capture path with no Node and no
// @opentelemetry/instrumentation dependency, so a browser-targeted tsc
// program can consume it without pulling @types/node into its globals.
// @everr/otel-web's server entry is its consumer.
export { type CaptureInput, Client } from "./client.js";
export { type NormalizedError, normalizeError } from "./normalize.js";
export { RateLimiter } from "./rate-limit.js";
export {
  type CollectBehavior,
  DEFAULT_SCRUB_PATTERNS,
  scrubAttributes,
  scrubString,
  stripUrlQueryAndFragment,
} from "./scrub.js";
export type {
  ErrorEvent,
  ErrorSeverity,
  Mechanism,
  Options,
} from "./types.js";
export { PKG_NAME, PKG_VERSION } from "./version.js";
