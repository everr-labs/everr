import { createFileRoute, redirect } from "@tanstack/react-router";

// Merged into the Monitor "Silences" view. Kept as a redirect for bookmarks.
// (The old `?prefill` deep-link can't survive the dashboard search schema, so the
// firing-alert "Silence" shortcut now hands off via router state instead.)
export const Route = createFileRoute(
  "/_authenticated/_dashboard/cc-alerting/silences",
)({
  beforeLoad: () => {
    throw redirect({ to: "/cc-alerting/monitor/silences" });
  },
});
