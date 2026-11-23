import { createFileRoute } from "@tanstack/react-router";
import { MetricsRoute } from "../../explore/pages";
import { metricsRoute } from "../../explore/routes";

export const Route = createFileRoute("/_shell/_explore/metrics")({
  ...metricsRoute,
  component: MetricsRoute,
});
