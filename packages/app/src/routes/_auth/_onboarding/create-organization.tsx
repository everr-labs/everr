import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { organizationReturnToSchema } from "@/common/organization-onboarding";
import { OrganizationCreation } from "@/components/organization-creation";
import { getOrganizationCreationOptions } from "@/data/organizations";

export const Route = createFileRoute("/_auth/_onboarding/create-organization")({
  validateSearch: z.object({
    returnTo: organizationReturnToSchema.default("/"),
  }),
  loader: () => getOrganizationCreationOptions(),
  head: () => ({ meta: [{ title: "Everr - Create your organization" }] }),
  component: CreateOrganizationPage,
});

function CreateOrganizationPage() {
  const { canCreateHobby } = Route.useLoaderData();
  const { returnTo } = Route.useSearch();
  return (
    <OrganizationCreation canCreateHobby={canCreateHobby} returnTo={returnTo} />
  );
}
