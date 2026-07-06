import { createFileRoute } from "@tanstack/react-router";
import {
  deleteResource,
  getResource,
  isResourceKind,
  RESOURCE_KINDS,
} from "@/data/as-code/resource-admin.server";

function badKind(kind: string): Response {
  return Response.json(
    {
      error: `unknown kind "${kind}"; expected one of ${RESOURCE_KINDS.join(", ")}`,
    },
    { status: 400 },
  );
}

function notFound(kind: string, project: string, slug: string): Response {
  return Response.json(
    { error: `resource not found: ${kind}/${project}/${slug}` },
    { status: 404 },
  );
}

// Auth + org context comes from the parent `/api/cli` route
// (requireOrgMiddleware); these are session-authenticated CLI endpoints.
export const Route = createFileRoute("/api/cli/resources/$kind/$project/$slug")(
  {
    server: {
      handlers: {
        GET: async ({ params, context }) => {
          const { kind, project, slug } = params;
          if (!isResourceKind(kind)) return badKind(kind);
          const document = await getResource(
            context.session.session.activeOrganizationId,
            kind,
            project,
            slug,
          );
          if (document === null) return notFound(kind, project, slug);
          return Response.json(document);
        },
        DELETE: async ({ params, context }) => {
          const { kind, project, slug } = params;
          if (!isResourceKind(kind)) return badKind(kind);
          const deleted = await deleteResource(
            context.session.session.activeOrganizationId,
            kind,
            project,
            slug,
          );
          if (!deleted) return notFound(kind, project, slug);
          return Response.json({ ok: true, kind, project, slug });
        },
      },
    },
  },
);
