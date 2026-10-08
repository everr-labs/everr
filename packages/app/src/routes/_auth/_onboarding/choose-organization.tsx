import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { organizationReturnToSchema } from "@/common/organization-onboarding";
import { OrganizationSelection } from "@/components/organization-selection";

export const Route = createFileRoute("/_auth/_onboarding/choose-organization")({
  validateSearch: z.object({
    returnTo: organizationReturnToSchema.default("/"),
  }),
  head: () => ({ meta: [{ title: "Everr - Choose your organization" }] }),
  component: OrganizationSelection,
});
