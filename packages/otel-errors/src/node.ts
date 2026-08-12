// The Node entry. It contains all the code that needs `process` or
// @opentelemetry/instrumentation. The code for all runtimes is in ./core.
//
// This entry does not export CaptureInput, and this is correct. The ./core
// entry supplies `capture`. Thus in this entry the type gives an argument that
// no caller can send.
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
