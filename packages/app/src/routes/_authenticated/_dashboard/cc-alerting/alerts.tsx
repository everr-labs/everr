import { createFileRoute, redirect } from "@tanstack/react-router";

// Merged into the Monitor view. Kept as a redirect for existing bookmarks.
export const Route = createFileRoute(
  "/_authenticated/_dashboard/cc-alerting/alerts",
)({
  beforeLoad: () => {
    throw redirect({ to: "/cc-alerting/monitor/active" });
  },
});
