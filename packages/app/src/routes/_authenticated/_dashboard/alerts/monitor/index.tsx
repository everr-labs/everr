import { createFileRoute, redirect } from "@tanstack/react-router";

// `/alerts/monitor` has no page of its own — default to the Active view.
export const Route = createFileRoute(
  "/_authenticated/_dashboard/alerts/monitor/",
)({
  beforeLoad: () => {
    throw redirect({ to: "/alerts/monitor/active" });
  },
});
