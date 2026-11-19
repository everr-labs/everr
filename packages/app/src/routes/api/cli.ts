import { createFileRoute } from "@tanstack/react-router";
import { requireOrgRequestMiddleware } from "#app/lib/org-request-middleware.server.ts";

export const Route = createFileRoute("/api/cli")({
  server: {
    middleware: [requireOrgRequestMiddleware],
  },
});
