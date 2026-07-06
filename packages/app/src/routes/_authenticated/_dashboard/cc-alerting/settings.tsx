import { createFileRoute, redirect } from "@tanstack/react-router";

// Webhook-feed subscriptions moved into the unified notifications page.
// Kept for bookmarks.
export const Route = createFileRoute(
  "/_authenticated/_dashboard/cc-alerting/settings",
)({
  beforeLoad: () => {
    throw redirect({ to: "/alerts/notifications", hash: "firehose" });
  },
});
