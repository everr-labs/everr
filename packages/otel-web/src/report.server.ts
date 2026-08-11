// The report function for the server. The "node" condition of the "#report"
// subpath in package.json selects this module, and the react entry imports
// that subpath. Thus a React error boundary on the server sends its errors
// through @everr/otel-errors, and no code changes a binding at run time.
//
// The capture function makes the error regular, and it marks the active span
// with recordException and setStatus(ERROR). It has one client for each
// process, and it needs no setup call. Thus this module has no state.
//
// The /core subpath is the part of that package for all runtimes. It keeps the
// instrumentation and its @types/node requirement out of the browser tsc
// program of this package. That program has no Node types, and this is
// correct.
import { capture } from "@everr/otel-errors/core";
import type { Report } from "./errors.js";

export const report: Report = (error, mechanism, context) => {
  capture({ error, mechanism, context });
};
