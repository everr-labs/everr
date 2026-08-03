// captureError is the manual reporting surface for handled errors; it flows
// through the SDK's emitter once init() has run and safely warns before
// that. init() works in both module graphs of a full-stack framework: the
// browser gets the full signal set, the server gets logger and captureError
// on the same pipeline. React-specific exports live in the dedicated
// `@everr/web-sdk/react` entry.

export { init } from "./client.js";
export { captureError } from "./errors.js";
export { logger } from "./logger.js";
export type {
  CaptureSignal,
  ConsentedClient,
  ConsentedInitOptions,
  CookielessClient,
  CookielessInitOptions,
  EverrClient,
  InitOptions,
} from "./types.js";
