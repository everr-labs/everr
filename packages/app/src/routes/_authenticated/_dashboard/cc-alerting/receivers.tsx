import { createFileRoute, redirect } from "@tanstack/react-router";

// Merged into the unified notifications page. Kept as a redirect for
// existing bookmarks.
export const Route = createFileRoute(
  "/_authenticated/_dashboard/cc-alerting/receivers",
)({
  beforeLoad: () => {
    throw redirect({ to: "/alerts/notifications", hash: "receivers" });
  },
});
