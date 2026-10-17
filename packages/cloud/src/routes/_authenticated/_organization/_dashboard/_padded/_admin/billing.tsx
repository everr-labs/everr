import { createFileRoute } from "@tanstack/react-router";
import { BillingPage } from "../../../../../../pages/billing";

export const Route = createFileRoute(
  "/_authenticated/_organization/_dashboard/_padded/_admin/billing",
)({
  staticData: { breadcrumb: "Plan & Billing", hideTimeRangePicker: true },
  head: () => ({
    meta: [{ title: "Everr - Plan & Billing" }],
  }),
  component: BillingPage,
});
