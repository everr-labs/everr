import { TracesRoute } from "@everr/telemetry-explorer/explore/pages";
import { tracesRoute } from "@everr/telemetry-explorer/explore/routes";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_shell/_explore/traces")({
  ...tracesRoute,
  component: TracesRoute,
});
