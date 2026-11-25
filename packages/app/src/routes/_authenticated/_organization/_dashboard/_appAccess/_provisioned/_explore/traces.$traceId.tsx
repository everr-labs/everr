import { TracesError, TraceDetailRoute } from "@everr/telemetry-explorer/explore/pages";
import { traceDetailRoute } from "@everr/telemetry-explorer/explore/routes";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute(
  "/_authenticated/_organization/_dashboard/_appAccess/_provisioned/_explore/traces/$traceId",
)({ ...traceDetailRoute, component: TraceDetailRoute, errorComponent: TracesError });
