import { createFileRoute } from "@tanstack/react-router";
import { runSqlRequest } from "#app/lib/sql-request.server.ts";

export const Route = createFileRoute("/api/cli/sql")({
  server: {
    handlers: {
      POST: ({ request, context }) =>
        runSqlRequest({
          request,
          organizationId: context.session.session.activeOrganizationId,
          organizationMetadata: context.organization.metadata,
        }),
    },
  },
});
