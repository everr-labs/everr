import { createFileRoute, redirect } from "@tanstack/react-router";

// Merged into the Monitor "Stream" view. Kept as a redirect for bookmarks.
export const Route = createFileRoute(
  "/_authenticated/_dashboard/cc-alerting/events",
)({
  beforeLoad: () => {
    throw redirect({ to: "/cc-alerting/monitor/stream" });
  },
});
