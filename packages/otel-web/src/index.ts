// captureError is the manual reporting surface for handled errors; it flows
// through the SDK's emitter once init() has run and safely warns before
// that. identify()/revoke() work the same way, live once a browser init()
// has run; the `persistence` option decides how long their ids live.
// init() works in both module graphs of a full-stack framework: the browser
// gets the full signal set, the server gets logger and captureError on the
// same pipeline. React-specific exports live in the dedicated
// `@everr/otel-web/react` entry.

export { setAttributes } from "./attributes.js";
export { init } from "./client.js";
export type { AttrValue } from "./emitter.js";
export { captureError } from "./errors.js";
export { logger } from "./logger.js";
export type { Plugin, PluginContext } from "./plugins.js";
export { setRouteResolver } from "./route.js";
export { identify, revoke, setPersistence } from "./session.js";
export type {
  CaptureSignal,
  EverrClient,
  InitOptions,
  Persistence,
  UserTraits,
} from "./types.js";
