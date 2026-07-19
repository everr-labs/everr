// Silences live on the Triage page now (muting belongs where muting
// happens); this route survives only so old deep links keep working.
import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute(
  "/_authenticated/_dashboard/alerts/silences",
)({
  beforeLoad: () => {
    throw redirect({ to: "/alerts/triage", hash: "silences" });
  },
});
