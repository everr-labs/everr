import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute(
  "/_authenticated/_dashboard/_previewable/alerts",
)({
  // The rule inventory's state chart reads the app-wide time range, so this
  // section keeps the topnav picker rather than hiding it.
  //
  // No breadcrumb here: Triage, Silences, and Notifications each carry their
  // own top-level one. The section's destinations live in the global sidebar
  // (`lib/navigation.ts`), so there is nothing to render around the children
  // and the router's default `<Outlet />` is the whole layout.
  head: () => ({ meta: [{ title: "Everr - Alerting" }] }),
});
