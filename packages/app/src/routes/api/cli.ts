import { createFileRoute } from "@tanstack/react-router";
import { requireOrgMiddleware } from "@/lib/serverFn";

/**
 * Wraps all CLI API routes with auth + org middleware.
 */
export const Route = createFileRoute("/api/cli")({
  server: {
    middleware: [requireOrgMiddleware],
  },
});
