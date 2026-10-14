import { getAppAccess } from "@app/app-access";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute(
  "/_authenticated/_organization/_dashboard/_appAccess",
)({
  beforeLoad: async () => ({ entitlement: await getAppAccess() }),
});
