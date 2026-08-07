// The Node entry: everything that needs `process` or
// @opentelemetry/instrumentation. Runtime-neutral pieces live in ./core.
export { type CaptureErrorOptions, captureError } from "./capture.js";
export { type CaptureInput, Client } from "./client.js";
export {
  ErrorsInstrumentation,
  type ErrorsInstrumentationConfig,
} from "./instrumentation.js";
export type {
  ErrorEvent,
  ErrorSeverity,
  Mechanism,
  Options,
} from "./types.js";
