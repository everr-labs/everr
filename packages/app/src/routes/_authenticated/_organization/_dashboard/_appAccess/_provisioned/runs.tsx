import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute(
  "/_authenticated/_organization/_dashboard/_appAccess/_provisioned/runs",
)({
  staticData: { breadcrumb: "Runs" },
  head: () => ({
    meta: [{ title: "Everr - Runs" }],
  }),
});
