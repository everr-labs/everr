import { createFileRoute, redirect } from "@tanstack/react-router";
import { requireOrganization } from "#app/lib/route-access.ts";

export const Route = createFileRoute("/_authenticated/_organization")({
  beforeLoad: async (options) => {
    const { entryRedirect, ...context } = await requireOrganization(options);
    if (entryRedirect)
      throw redirect({
        ...entryRedirect,
        search: { returnTo: options.location.href },
        replace: true,
      });
    return context;
  },
});
