import { init } from "../../dist/node.js";
import { installStdoutTelemetry } from "./fixture-exporter.mjs";

installStdoutTelemetry();
init();

setTimeout(() => {
  throw new Error("fixture-crash");
}, 10);
