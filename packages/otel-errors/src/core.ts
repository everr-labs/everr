// The entry for all runtimes. It contains the capture path. It does not use
// Node and it does not use @opentelemetry/instrumentation. Thus a tsc program
// for a browser can use it, and @types/node does not go into the globals of
// that program. The server entry of @everr/otel-web uses this entry.
//
// This entry exports `capture`, and the ./node entry does not. The `capture`
// function is for the SDKs that are built on this package, because they report
// their own mechanisms. An application uses `captureError`.
export { capture, configure, setLogger } from "./capture.js";
export type { CaptureInput } from "./client.js";
export { type NormalizedError, normalizeError } from "./normalize.js";
export type {
  ClientOptions,
  ErrorEvent,
  ErrorSeverity,
  Mechanism,
} from "./types.js";
export { PKG_NAME, PKG_VERSION } from "./version.js";
