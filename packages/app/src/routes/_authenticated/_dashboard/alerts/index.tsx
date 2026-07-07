import { createFileRoute, redirect } from "@tanstack/react-router";

// `/alerts` has no page of its own — send it to the section landing.
export const Route = createFileRoute("/_authenticated/_dashboard/alerts/")({
  beforeLoad: () => {
    throw redirect({ to: "/alerts/triage" });
  },
});
