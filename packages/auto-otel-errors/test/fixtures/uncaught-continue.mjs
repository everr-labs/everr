import { init } from "../../dist/node.js";
import { installStdoutTelemetry } from "./fixture-exporter.mjs";

installStdoutTelemetry();
init({ onFatal: "continue" });

setTimeout(() => {
  throw new Error("fixture-survivable");
}, 10);

setTimeout(() => process.exit(0), 200);
