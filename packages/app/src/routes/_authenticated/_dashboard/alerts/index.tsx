import { createFileRoute, redirect } from "@tanstack/react-router";

// `/alerts` has no page of its own — send it to the section landing. SLOs
// lead: the section opens on objectives, and drops to the triage inbox.
export const Route = createFileRoute("/_authenticated/_dashboard/alerts/")({
  beforeLoad: () => {
    throw redirect({ to: "/alerts/slos" });
  },
});
