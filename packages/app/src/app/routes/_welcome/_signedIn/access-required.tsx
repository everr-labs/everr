import { createFileRoute, redirect } from "@tanstack/react-router";
import { z } from "zod";
import { WorkspaceAccessRequired } from "@/app/pages/access-required";
import { returnToSchema } from "@/common/return-to";
import { getActiveOrganizationAccess } from "@/data/organization-access";

export const Route = createFileRoute("/_welcome/_signedIn/access-required")({
  validateSearch: z.object({ returnTo: returnToSchema.default("/") }),
  beforeLoad: async ({ search }) => {
    const access = await getActiveOrganizationAccess();
    if (access.status === "available") {
      throw redirect({ href: search.returnTo, replace: true });
    }
  },
  head: () => ({ meta: [{ title: "Everr - Workspace access required" }] }),
  component: WorkspaceAccessRequired,
});
