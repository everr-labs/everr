import { MetricsRoute } from "@everr/telemetry-explorer/explore/pages";
import { metricsRoute } from "@everr/telemetry-explorer/explore/routes";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute(
  "/_authenticated/_organization/_dashboard/_appAccess/_provisioned/_explore/metrics",
)({ ...metricsRoute, component: MetricsRoute });
