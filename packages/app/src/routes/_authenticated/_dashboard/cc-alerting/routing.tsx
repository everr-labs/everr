import { createFileRoute, redirect } from "@tanstack/react-router";

// Merged into the unified /alerts/notifications page. Kept as a redirect for
// existing bookmarks; the #routes/#receivers/#firehose/#inhibitions anchors
// live on the new page, so the incoming hash is carried over.
export const Route = createFileRoute(
  "/_authenticated/_dashboard/cc-alerting/routing",
)({
  beforeLoad: ({ location }) => {
    throw redirect({
      to: "/alerts/notifications",
      hash: location.hash || undefined,
    });
  },
});
