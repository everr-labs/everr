import { MetricsRoute } from "@everr/app-shell/explore/pages";
import { metricsRoute } from "@everr/app-shell/explore/routes";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_shell/_explore/metrics")({
  ...metricsRoute,
  component: MetricsRoute,
});
