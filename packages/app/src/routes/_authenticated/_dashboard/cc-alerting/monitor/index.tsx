import { createFileRoute, redirect } from "@tanstack/react-router";

// `/cc-alerting/monitor` has no page of its own — default to the Active view.
export const Route = createFileRoute(
  "/_authenticated/_dashboard/cc-alerting/monitor/",
)({
  beforeLoad: () => {
    throw redirect({ to: "/cc-alerting/monitor/active" });
  },
});
