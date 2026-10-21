import { initializeTelemetry, TelemetryContextSchema } from "./internal-telemetry";
import { invokeCommand } from "./local-api";

if (typeof window !== "undefined") {
  void invokeCommand("get_telemetry_context", TelemetryContextSchema)
    .then(initializeTelemetry)
    .catch(() => {});
}
