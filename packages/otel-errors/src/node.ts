// The Node entry: everything that needs `process` or
// @opentelemetry/instrumentation. Runtime-neutral pieces live in ./core.
// CaptureInput is deliberately absent: `capture` is a ./core surface, so on
// this entry the type describes an argument nobody can pass.
export { captureError, configure, setLogger } from "./capture.js";
export {
  ErrorsInstrumentation,
  type ErrorsInstrumentationConfig,
} from "./instrumentation.js";
export type {
  ClientOptions,
  ErrorEvent,
  ErrorSeverity,
  Mechanism,
} from "./types.js";
