import { init } from "../../dist/node.js";
import { installStdoutTelemetry } from "./fixture-exporter.mjs";

installStdoutTelemetry();
init();

// Intentionally unhandled: this fixture verifies the instrumentation reacts to an
// unhandledRejection and exits. `void` keeps it unhandled (adds no rejection handler).
void Promise.reject(new Error("fixture-rejection"));
