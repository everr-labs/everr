import { ErrorModalRoute } from "@everr/app-shell/explore/pages";
import { errorDetailRoute } from "@everr/app-shell/explore/routes";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute(
  "/_authenticated/_organization/_dashboard/_appAccess/_provisioned/_explore/errors/$fingerprint/modal",
)({ ...errorDetailRoute, component: ErrorModalRoute });
