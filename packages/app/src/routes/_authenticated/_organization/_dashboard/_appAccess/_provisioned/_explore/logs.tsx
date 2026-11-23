import { LogsRoute } from "@everr/telemetry-explorer/explore/pages";
import { logsRoute } from "@everr/telemetry-explorer/explore/routes";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute(
  "/_authenticated/_organization/_dashboard/_appAccess/_provisioned/_explore/logs",
)({ ...logsRoute, component: LogsRoute });
