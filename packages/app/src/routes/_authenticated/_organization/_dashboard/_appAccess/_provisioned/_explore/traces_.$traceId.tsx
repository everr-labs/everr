import { TraceDetailError, TraceDetailRoute } from "@everr/telemetry-explorer/explore/pages";
import { traceDetailRoute } from "@everr/telemetry-explorer/explore/routes";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute(
  "/_authenticated/_organization/_dashboard/_appAccess/_provisioned/_explore/traces_/$traceId",
)({ ...traceDetailRoute, component: TraceDetailRoute, errorComponent: TraceDetailError });
