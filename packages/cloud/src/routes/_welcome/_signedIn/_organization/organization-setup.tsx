import { returnToSchema } from "@everr/app/common/return-to";
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { OrganizationSetup } from "../../../../components/organization-setup";

export const Route = createFileRoute(
  "/_welcome/_signedIn/_organization/organization-setup",
)({
  validateSearch: z.object({ returnTo: returnToSchema.default("/") }),
  head: () => ({ meta: [{ title: "Everr - Organization setup" }] }),
  component: OrganizationSetup,
});
