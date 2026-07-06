import { createFileRoute } from "@tanstack/react-router";
import {
  isResourceKind,
  listResources,
  unknownKindResponse,
} from "@/data/as-code/resource-admin.server";

// Auth + org context comes from the parent `/api/cli` route
// (requireOrgMiddleware): these are session-authenticated CLI endpoints, so the
// handler reads context.session.session.activeOrganizationId directly.
export const Route = createFileRoute("/api/cli/resources")({
  server: {
    handlers: {
      GET: async ({ request, context }) => {
        const url = new URL(request.url);
        const kindParam = url.searchParams.get("kind") ?? undefined;
        if (kindParam !== undefined && !isResourceKind(kindParam)) {
          return unknownKindResponse(kindParam);
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
