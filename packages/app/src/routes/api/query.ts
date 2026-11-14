import { createFileRoute } from "@tanstack/react-router";
import { requireOrgOrQueryKeyMiddleware } from "#app/data/query-auth.server.ts";
import { runSqlRequest } from "#app/lib/sql-request.server.ts";

// The CLI's SQL query, for an API key as well as a session. It sits outside
// /api/cli, whose routes take a logged-in session only.
export const Route = createFileRoute("/api/query")({
  server: {
    middleware: [requireOrgOrQueryKeyMiddleware],
    handlers: {
      POST: ({ request, context }) =>
        runSqlRequest({
          request,
          organizationId: context.organizationId,
          organizationMetadata: context.organizationMetadata,
        }),
    },
  },
});
