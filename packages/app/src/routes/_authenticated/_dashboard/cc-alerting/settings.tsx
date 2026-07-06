import { createFileRoute, redirect } from "@tanstack/react-router";

// Firehose subscriptions moved into the Routing page. Kept for bookmarks.
export const Route = createFileRoute(
  "/_authenticated/_dashboard/cc-alerting/settings",
)({
  beforeLoad: () => {
    throw redirect({ to: "/cc-alerting/routing", hash: "firehose" });
  },
});
