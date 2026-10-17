import { navigation } from "@composition/navigation";

import { createFileRoute } from "@tanstack/react-router";
import { requireOrganization } from "@/lib/route-access";

const { afterOrganizationSelected } = navigation;

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
