import { createFileRoute } from "@tanstack/react-router";
import { authMiddleware } from "@/lib/serverFn";

/**
 * Wraps all CLI API routes with the auth middleware.
 */
export const Route = createFileRoute("/api/cli")({
  server: {
    middleware: [authMiddleware],
  },
});
