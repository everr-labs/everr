import { createFileRoute } from "@tanstack/react-router";
import {
  canApplyMutate,
  requireOrgOrApiKeyMiddleware,
} from "@/data/as-code/apply-auth.server";
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

const READ_ONLY_KEY =
  "API key is read-only: grant the apply write capability to modify resources";

export const Route = createFileRoute("/api/cli/resources/$kind/$project/$slug")(
  {
    server: {
      middleware: [requireOrgOrApiKeyMiddleware],
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
          if (!canApplyMutate(context.applyActions)) {
            return Response.json({ error: READ_ONLY_KEY }, { status: 403 });
          }
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
