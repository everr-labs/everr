import { createFileRoute } from "@tanstack/react-router";
import { TraceDetailError, TraceDetailRoute } from "../../explore/pages";
import { traceDetailRoute } from "../../explore/routes";

export const Route = createFileRoute("/_shell/_explore/traces_/$traceId")({
  ...traceDetailRoute,
  component: TraceDetailRoute,
  errorComponent: TraceDetailError,
});
