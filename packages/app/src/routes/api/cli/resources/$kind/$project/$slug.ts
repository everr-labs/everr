import { createFileRoute } from "@tanstack/react-router";
import {
  deleteResource,
  getResource,
  isResourceKind,
  notFoundResponse,
  unknownKindResponse,
} from "@/data/as-code/resource-admin.server";

// Auth + org context comes from the parent `/api/cli` route
// (requireOrgMiddleware); these are session-authenticated CLI endpoints.
export const Route = createFileRoute("/api/cli/resources/$kind/$project/$slug")(
  {
    server: {
      handlers: {
        GET: async ({ params, context }) => {
          const { kind, project, slug } = params;
          if (!isResourceKind(kind)) return unknownKindResponse(kind);
          const document = await getResource(
            context.session.session.activeOrganizationId,
            kind,
            project,
            slug,
          );
          if (document === null) return notFoundResponse(kind, project, slug);
          return Response.json(document);
        },
        DELETE: async ({ params, context }) => {
          const { kind, project, slug } = params;
          if (!isResourceKind(kind)) return unknownKindResponse(kind);
          const deleted = await deleteResource(
            context.session.session.activeOrganizationId,
            kind,
            project,
            slug,
          );
          if (!deleted) return notFoundResponse(kind, project, slug);
          return Response.json({ ok: true, kind, project, slug });
        },
      },
    },
  },
);
