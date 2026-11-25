import { createFileRoute } from "@tanstack/react-router";
import { TracesError, TraceDetailRoute } from "../../explore/pages";
import { traceDetailRoute } from "../../explore/routes";

export const Route = createFileRoute("/_shell/_explore/traces/$traceId")({
  ...traceDetailRoute,
  component: TraceDetailRoute,
  errorComponent: TracesError,
});
