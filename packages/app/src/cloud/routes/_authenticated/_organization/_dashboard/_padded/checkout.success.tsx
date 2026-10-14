import { createFileRoute } from "@tanstack/react-router";
import * as z from "zod";
import { CheckoutSuccessPage } from "@/cloud/pages/checkout";

const SearchSchema = z.object({
  checkout_id: z.string().optional(),
});

export const Route = createFileRoute(
  "/_authenticated/_organization/_dashboard/_padded/checkout/success",
)({
  staticData: { breadcrumb: "Checkout", hideTimeRangePicker: true },
  head: () => ({
    meta: [{ title: "Everr - Checkout complete" }],
  }),
  validateSearch: SearchSchema,
  component: CheckoutSuccessPage,
});
