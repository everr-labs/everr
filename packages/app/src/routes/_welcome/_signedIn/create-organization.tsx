import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { returnToSchema } from "@/common/return-to";
import { OrganizationCreation } from "@/components/organization-creation";
import { getOrganizationCreationOptions } from "@/data/organizations";

export const Route = createFileRoute("/_welcome/_signedIn/create-organization")(
  {
    validateSearch: z.object({
      returnTo: returnToSchema.default("/"),
    }),
    loader: () => getOrganizationCreationOptions(),
    head: () => ({ meta: [{ title: "Everr - Create your organization" }] }),
    component: CreateOrganizationPage,
  },
);

function CreateOrganizationPage() {
  const { canCreateHobby } = Route.useLoaderData();
  const { returnTo } = Route.useSearch();
  return (
    <OrganizationCreation canCreateHobby={canCreateHobby} returnTo={returnTo} />
  );
}
