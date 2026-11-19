import { createFileRoute } from "@tanstack/react-router";
import { requireCliOrgMiddleware } from "#app/lib/cli-auth.server.ts";

export const Route = createFileRoute("/api/cli")({
  server: {
    middleware: [requireCliOrgMiddleware],
  },
});
