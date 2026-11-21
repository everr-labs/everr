import { LogsRoute } from "@everr/app-shell/explore/pages";
import { logsRoute } from "@everr/app-shell/explore/routes";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_shell/_explore/logs")({
  ...logsRoute,
  component: LogsRoute,
});
