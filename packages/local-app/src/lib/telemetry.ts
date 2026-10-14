import {
  initializeTelemetry,
  type TelemetryContext,
} from "./internal-telemetry";
import { invokeCommand } from "./local-api";

if (typeof window !== "undefined") {
  void invokeCommand<TelemetryContext>("get_telemetry_context")
    .then(initializeTelemetry)
    .catch(() => {});
}
