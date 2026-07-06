import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import {
  canApplyMutate,
  requireOrgOrApiKeyMiddleware,
} from "@/data/as-code/apply-auth.server";
import {
  adoptResource,
  isResourceKind,
  RESOURCE_KINDS,
} from "@/data/as-code/resource-admin.server";

const BodySchema = z.object({ repoid: z.string().min(1) });

export const Route = createFileRoute(
  "/api/cli/resources/$kind/$project/$slug/adopt",
)({
  server: {
    middleware: [requireOrgOrApiKeyMiddleware],
    handlers: {
      POST: async ({ request, params, context }) => {
        const { kind, project, slug } = params;
        if (!isResourceKind(kind)) {
          return Response.json(
            {
              error: `unknown kind "${kind}"; expected one of ${RESOURCE_KINDS.join(
                ", ",
              )}`,
            },
            { status: 400 },
          );
        }
        if (!canApplyMutate(context.applyActions)) {
          return Response.json(
            {
              error:
                "API key is read-only: grant the apply write capability to modify resources",
            },
            { status: 403 },
          );
        }
        const parsed = BodySchema.safeParse(await request.json());
        if (!parsed.success) {
          return Response.json(
            { error: "body must be { repoid: <non-empty string> }" },
            { status: 400 },
          );
        }
        const result = await adoptResource(
          context.session.session.activeOrganizationId,
          kind,
          project,
          slug,
          parsed.data.repoid,
        );
        if (!result.found) {
          return Response.json(
            { error: `resource not found: ${kind}/${project}/${slug}` },
            { status: 404 },
          );
        }
        return Response.json({
          kind,
          project,
          slug,
          repoid: result.repoid,
          alreadyOwned: result.alreadyOwned,
        });
      },
    },
  },
});
