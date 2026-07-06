import { createFileRoute, redirect } from "@tanstack/react-router";

// Merged into the Routing page. Kept as a redirect for existing bookmarks.
export const Route = createFileRoute(
  "/_authenticated/_dashboard/cc-alerting/receivers",
)({
  beforeLoad: () => {
    throw redirect({ to: "/cc-alerting/routing", hash: "receivers" });
  },
});
