import { init } from "../../dist/node.js";
import { installStdoutTelemetry } from "./fixture-exporter.mjs";

installStdoutTelemetry();
init();

Promise.reject(new Error("fixture-rejection"));
