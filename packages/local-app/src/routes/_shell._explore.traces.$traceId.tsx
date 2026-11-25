import { TracesError, TraceDetailRoute } from "@everr/telemetry-explorer/explore/pages";
import { traceDetailRoute } from "@everr/telemetry-explorer/explore/routes";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_shell/_explore/traces/$traceId")({
  ...traceDetailRoute,
  component: TraceDetailRoute,
  errorComponent: TracesError,
});
