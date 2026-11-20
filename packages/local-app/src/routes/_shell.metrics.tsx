import { MetricsSearchSchema } from "@everr/telemetry-explorer/metrics";
import { createFileRoute } from "@tanstack/react-router";
import { MetricsPage } from "../features/metrics/metrics-page";
export const Route = createFileRoute("/_shell/metrics")({
  validateSearch: MetricsSearchSchema,
  component: MetricsPage,
});
