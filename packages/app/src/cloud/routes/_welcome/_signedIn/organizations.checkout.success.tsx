import { createFileRoute } from "@tanstack/react-router";
import * as z from "zod";
import { ProOrganizationCheckoutSuccess } from "@/cloud/pages/organization-checkout";
import { returnToSchema } from "@/common/return-to";

const SearchSchema = z.object({
  checkout_id: z.string().optional(),
  returnTo: returnToSchema.default("/"),
});

export const Route = createFileRoute(
  "/_welcome/_signedIn/organizations/checkout/success",
)({
  validateSearch: SearchSchema,
  head: () => ({ meta: [{ title: "Everr - Organization setup" }] }),
  component: ProOrganizationCheckoutSuccess,
});
