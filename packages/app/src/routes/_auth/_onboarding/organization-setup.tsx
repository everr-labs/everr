import { createFileRoute, redirect } from "@tanstack/react-router";
import { z } from "zod";
import {
  isMissingOrganizationError,
  organizationReturnToSchema,
} from "@/common/organization-onboarding";
import { OrganizationSetup } from "@/components/organization-setup";
import { getActiveOrganization } from "@/data/auth";

export const Route = createFileRoute("/_auth/_onboarding/organization-setup")({
  validateSearch: z.object({
    returnTo: organizationReturnToSchema.default("/"),
  }),
  beforeLoad: async ({ context, search }) => {
    const chooseOrganization = () =>
      redirect({
        to: "/choose-organization",
        search: { returnTo: search.returnTo },
        replace: true,
      });
    if (!context.session.session.activeOrganizationId)
      throw chooseOrganization();
    const organization = await getActiveOrganization().catch((cause) => {
      if (isMissingOrganizationError(cause)) throw chooseOrganization();
      throw cause;
    });
    if (!organization) throw chooseOrganization();
  },
  head: () => ({ meta: [{ title: "Everr - Organization setup" }] }),
  component: OrganizationSetup,
});
