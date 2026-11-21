import { TraceDetailError, TraceDetailRoute } from "@everr/app-shell/explore/pages";
import { traceDetailRoute } from "@everr/app-shell/explore/routes";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_shell/_explore/traces_/$traceId")({
  ...traceDetailRoute,
  component: TraceDetailRoute,
  errorComponent: TraceDetailError,
});
