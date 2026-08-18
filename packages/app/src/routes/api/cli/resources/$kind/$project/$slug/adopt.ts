import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import {
  adoptResource,
  isResourceKind,
} from "@/data/as-code/resource-admin.server";
import {
  guardReservedProject,
  notFoundResponse,
  unknownKindResponse,
} from "../../../-responses";

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
        const result = await guardReservedProject(() =>
          adoptResource(
            context.session.session.activeOrganizationId,
            kind,
            project,
            slug,
            parsed.data.repoid,
          ),
        );
        if (result instanceof Response) return result;
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
