import { MetricsRoute } from "@everr/telemetry-explorer/explore/pages";
import { metricsRoute } from "@everr/telemetry-explorer/explore/routes";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_shell/_explore/metrics")({
  ...metricsRoute,
  component: MetricsRoute,
});
