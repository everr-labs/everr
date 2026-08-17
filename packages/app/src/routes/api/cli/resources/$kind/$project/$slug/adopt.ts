import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import {
  adoptResource,
  isResourceKind,
} from "@/data/as-code/resource-admin.server";
import { BUILTIN_PROJECT } from "@/data/dashboards/schema";
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
        if (project === BUILTIN_PROJECT) {
          // Built-ins are catalog entries, not rows; there is no owner to
          // transfer. An editable copy is made by applying the document as
          // your own resource, not by adopting (ADR 0004).
          return Response.json(
            { error: "built-in dashboards cannot be adopted" },
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
