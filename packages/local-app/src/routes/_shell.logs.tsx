import { LogsSearchSchema } from "@everr/telemetry-explorer/logs";
import { createFileRoute } from "@tanstack/react-router";
import { LogsPage } from "../features/logs/logs-page";
export const Route = createFileRoute("/_shell/logs")({
  validateSearch: LogsSearchSchema,
  component: LogsPage,
});
