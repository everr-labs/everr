import { createFileRoute } from "@tanstack/react-router";
import { LogsRoute } from "../../explore/pages";
import { logsRoute } from "../../explore/routes";

export const Route = createFileRoute("/_shell/_explore/logs")({
  ...logsRoute,
  component: LogsRoute,
});
