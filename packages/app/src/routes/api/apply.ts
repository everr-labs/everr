import { createFileRoute } from "@tanstack/react-router";
import {
  canApplyMutate,
  requireOrgOrApiKeyMiddleware,
} from "@/data/as-code/apply-auth.server";
import { ApplyValidationError } from "@/data/as-code/errors";
import { applyResources } from "@/data/as-code/registry";
import { applyInput } from "@/data/as-code/schema";

export const Route = createFileRoute("/api/apply")({
  server: {
    middleware: [requireOrgOrApiKeyMiddleware],
    handlers: {
      POST: async ({ request, context }) => {
        let raw: unknown;
        try {
          raw = await request.json();
        } catch {
          return Response.json({ error: "Invalid JSON body" }, { status: 400 });
        }

        const parsed = applyInput.safeParse(raw);
        if (!parsed.success) {
          return Response.json(
            { error: parsed.error.issues[0]?.message ?? "Invalid request" },
            { status: 400 },
          );
        }

        // A read-only `apply` key may run the dry-run plan pass but must not
        // be able to issue a mutative apply. Session auth is unrestricted.
        if (!parsed.data.dryRun && !canApplyMutate(context.applyActions)) {
          return Response.json(
            {
              error:
                "API key is read-only: run with --dry-run or grant the apply write capability",
            },
            { status: 403 },
          );
        }

        try {
          const summary = await applyResources({
            orgId: context.session.session.activeOrganizationId,
            repoid: parsed.data.repoid,
            state: parsed.data.state,
            source: parsed.data.source,
            dryRun: parsed.data.dryRun,
            preview: parsed.data.preview,
          });
          return Response.json({
            ...summary,
            preview: parsed.data.preview ?? "",
            organization: context.organization,
          });
        } catch (error) {
          // Only bad input (unknown kind, invalid slug/spec, duplicate) is the
          // caller's fault → 400 with the message. Anything else is an
          // infrastructure failure: log it and return an opaque 500 so DB/
          // transaction internals don't leak and don't look like bad input.
          if (error instanceof ApplyValidationError) {
            return Response.json({ error: error.message }, { status: 400 });
          }
          console.error("apply failed", error);
          return Response.json(
            { error: "Internal error while applying" },
            { status: 500 },
          );
        }
      },
    },
  },
});
