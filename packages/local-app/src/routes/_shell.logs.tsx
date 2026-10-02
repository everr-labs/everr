import { createFileRoute } from "@tanstack/react-router";
import { LogsPage, LogsSearchSchema } from "../features/logs/logs-page";
export const Route = createFileRoute("/_shell/logs")({
  validateSearch: LogsSearchSchema,
  component: LogsPage,
});
