import { createFileRoute } from "@tanstack/react-router";
import { MetricsPage, MetricsPageSearchSchema } from "../features/metrics/metrics-page";
export const Route = createFileRoute("/_shell/metrics")({
  validateSearch: MetricsPageSearchSchema,
  component: MetricsPage,
});
