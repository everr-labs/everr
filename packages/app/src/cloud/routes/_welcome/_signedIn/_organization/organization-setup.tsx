import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { OrganizationSetup } from "@/cloud/components/organization-setup";
import { returnToSchema } from "@/common/return-to";

export const Route = createFileRoute(
  "/_welcome/_signedIn/_organization/organization-setup",
)({
  validateSearch: z.object({ returnTo: returnToSchema.default("/") }),
  head: () => ({ meta: [{ title: "Everr - Organization setup" }] }),
  component: OrganizationSetup,
});
