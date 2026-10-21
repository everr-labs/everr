import { initializeTelemetry } from "./internal-telemetry";
import { invokeCommand } from "./local-api";

if (typeof window !== "undefined") {
  void invokeCommand<unknown>("get_telemetry_context")
    .then(initializeTelemetry)
    .catch(() => {});
}
