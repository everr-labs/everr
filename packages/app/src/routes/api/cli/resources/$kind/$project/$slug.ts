import { createFileRoute } from "@tanstack/react-router";
import {
  deleteResource,
  getResource,
  isResourceKind,
} from "@/data/as-code/resource-admin.server";
import { getBuiltinDashboard } from "@/data/dashboards/built-in/catalog";
import { BUILTIN_PROJECT } from "@/data/dashboards/schema";
import {
  notFoundResponse,
  reservedProjectResponse,
  unknownKindResponse,
} from "../../-responses";

// Auth + org context comes from the parent `/api/cli` route
// (requireOrgMiddleware); these are session-authenticated CLI endpoints.
export const Route = createFileRoute("/api/cli/resources/$kind/$project/$slug")(
  {
    server: {
      handlers: {
        GET: async ({ params, context }) => {
          const { kind, project, slug } = params;
          if (!isResourceKind(kind)) return unknownKindResponse(kind);
          // Only dashboards exist under the `built-in` pseudo-project, and
          // only for reading: built-ins are catalog entries, not rows, so
          // there is nothing a write verb could touch (ADR 0004).
          if (project === BUILTIN_PROJECT) {
            const builtin =
              kind === "dashboard" ? getBuiltinDashboard(slug) : undefined;
            return builtin
              ? Response.json(builtin.document)
              : notFoundResponse(kind, project, slug);
          }
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
          let deleted: boolean;
          try {
            deleted = await deleteResource(
              context.session.session.activeOrganizationId,
              kind,
              project,
              slug,
            );
          } catch (error) {
            const forbidden = reservedProjectResponse(error);
            if (forbidden) return forbidden;
            throw error;
          }
          if (!deleted) return notFoundResponse(kind, project, slug);
          return Response.json({ ok: true, kind, project, slug });
        },
      },
    },
  },
);
