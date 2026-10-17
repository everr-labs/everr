import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { OrganizationSelection } from "../../../components/organization-selection";
import { returnToSchema } from "@everr/app/common/return-to";

export const Route = createFileRoute("/_welcome/_signedIn/choose-organization")(
  {
    validateSearch: z.object({
      returnTo: returnToSchema.default("/"),
    }),
    head: () => ({ meta: [{ title: "Everr - Choose your organization" }] }),
    component: OrganizationSelection,
  },
);
