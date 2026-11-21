import { TracesRoute } from "@everr/app-shell/explore/pages";
import { tracesRoute } from "@everr/app-shell/explore/routes";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute(
  "/_authenticated/_organization/_dashboard/_appAccess/_provisioned/_explore/traces",
)({ ...tracesRoute, component: TracesRoute });
