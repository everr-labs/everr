import { afterOrganizationSelected } from "@app/storage-readiness";
import { createFileRoute } from "@tanstack/react-router";
import { requireOrganization } from "@/lib/route-access";

export const Route = createFileRoute("/_authenticated/_organization")({
  beforeLoad: async (options) => {
    const context = await requireOrganization(options);
    afterOrganizationSelected(
      options.context.createdOrganizationId,
      context.organization.id,
      options.location.href,
    );
    return context;
  },
});
