import { createFileRoute } from "@tanstack/react-router";
import {
  deleteResource,
  getResource,
  isResourceKind,
} from "@/data/as-code/resource-admin.server";
import { getBuiltinDashboard } from "@/data/dashboards/built-in/catalog";
import { BUILTIN_PROJECT } from "@/data/dashboards/schema";
import { notFoundResponse, unknownKindResponse } from "../../-responses";

/**
 * Only dashboards exist under the `built-in` pseudo-project, and only for
 * reading: built-ins are catalog entries, not rows, so there is nothing a
 * write verb could touch (ADR 0004).
 */
function builtinDashboard(kind: string, project: string, slug: string) {
  if (kind !== "dashboard" || project !== BUILTIN_PROJECT) return null;
  return getBuiltinDashboard(slug) ?? null;
}

// Auth + org context comes from the parent `/api/cli` route
// (requireOrgMiddleware); these are session-authenticated CLI endpoints.
export const Route = createFileRoute("/api/cli/resources/$kind/$project/$slug")(
  {
    server: {
      handlers: {
        GET: async ({ params, context }) => {
          const { kind, project, slug } = params;
          if (!isResourceKind(kind)) return unknownKindResponse(kind);
          const builtin = builtinDashboard(kind, project, slug);
          if (builtin) return Response.json(builtin.document);
          if (project === BUILTIN_PROJECT)
            return notFoundResponse(kind, project, slug);
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
          if (project === BUILTIN_PROJECT) {
            return Response.json(
              {
                error:
                  "built-in dashboards ship with Everr and cannot be deleted",
              },
              { status: 403 },
            );
          }
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
