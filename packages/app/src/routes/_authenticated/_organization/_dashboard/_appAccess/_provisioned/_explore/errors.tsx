import { ErrorsRoute } from "@everr/telemetry-explorer/explore/pages";
import { errorsRoute } from "@everr/telemetry-explorer/explore/routes";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute(
  "/_authenticated/_organization/_dashboard/_appAccess/_provisioned/_explore/errors",
)({ ...errorsRoute, component: ErrorsRoute });
