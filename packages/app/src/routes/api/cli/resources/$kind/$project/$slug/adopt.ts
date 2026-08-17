import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import {
  adoptResource,
  isResourceKind,
  ReservedProjectError,
} from "@/data/as-code/resource-admin.server";
import { notFoundResponse, unknownKindResponse } from "../../../-responses";

const BodySchema = z.object({ repoid: z.string().min(1) });

// Auth + org context comes from the parent `/api/cli` route
// (requireOrgMiddleware); this is a session-authenticated CLI endpoint.
export const Route = createFileRoute(
  "/api/cli/resources/$kind/$project/$slug/adopt",
)({
  server: {
    handlers: {
      POST: async ({ request, params, context }) => {
        const { kind, project, slug } = params;
        if (!isResourceKind(kind)) return unknownKindResponse(kind);
        const parsed = BodySchema.safeParse(await request.json());
        if (!parsed.success) {
          return Response.json(
            { error: "body must be { repoid: <non-empty string> }" },
            { status: 400 },
          );
        }
        let result: Awaited<ReturnType<typeof adoptResource>>;
        try {
          result = await adoptResource(
            context.session.session.activeOrganizationId,
            kind,
            project,
            slug,
            parsed.data.repoid,
          );
        } catch (error) {
          if (error instanceof ReservedProjectError) {
            return Response.json({ error: error.message }, { status: 403 });
          }
          throw error;
        }
        if (!result.found) return notFoundResponse(kind, project, slug);
        return Response.json({
          kind,
          project,
          slug,
          repoid: parsed.data.repoid,
          alreadyOwned: result.alreadyOwned,
        });
      },
    },
  },
});
