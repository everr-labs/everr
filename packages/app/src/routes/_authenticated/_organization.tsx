import { createFileRoute, redirect } from "@tanstack/react-router";
import { requireOrganization } from "@/lib/route-access";

export const Route = createFileRoute("/_authenticated/_organization")({
  beforeLoad: async (options) => {
    const context = await requireOrganization(options);
    if (options.context.createdOrganizationId === context.organization.id)
      throw redirect({
        to: "/organization-setup",
        search: { returnTo: options.location.href },
        replace: true,
      });
    return context;
  },
});
