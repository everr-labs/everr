// captureError is the manual reporting surface for handled errors; it flows
// through the SDK's emitter once init() has run and safely drops errors
// before that, SSR included. React-specific exports live in the dedicated
// `@everr/web-sdk/react` entry.

export { init } from "./client.js";
export { captureError } from "./errors.js";
export type {
  CaptureSignal,
  ConsentedClient,
  ConsentedInitOptions,
  CookielessClient,
  CookielessInitOptions,
  EverrClient,
  InitOptions,
} from "./types.js";
