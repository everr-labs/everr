import { createFileRoute } from "@tanstack/react-router";
import { requireOrgOrApiKeyMiddleware } from "@/data/as-code/apply-auth.server";
import {
  isResourceKind,
  listResources,
  RESOURCE_KINDS,
} from "@/data/as-code/resource-admin.server";

export const Route = createFileRoute("/api/cli/resources")({
  server: {
    middleware: [requireOrgOrApiKeyMiddleware],
    handlers: {
      GET: async ({ request, context }) => {
        const url = new URL(request.url);
        const kindParam = url.searchParams.get("kind") ?? undefined;
        if (kindParam !== undefined && !isResourceKind(kindParam)) {
          return Response.json(
            {
              error: `unknown kind "${kindParam}"; expected one of ${RESOURCE_KINDS.join(
                ", ",
              )}`,
            },
            { status: 400 },
          );
        }
        const repoid = url.searchParams.get("repoid") ?? undefined;
        const resources = await listResources(
          context.session.session.activeOrganizationId,
          { kind: kindParam, repoid },
        );
        return Response.json(resources);
      },
    },
  },
});
