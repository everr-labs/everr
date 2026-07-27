// The React-facing surface of the SDK, a dedicated entry so the core stays
// framework-free. It shares the errors module (and its wiring to the live
// client) with the core entry, so reporting works whenever init() has run.
export { captureReactError } from "./errors.js";
