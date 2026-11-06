import { createFileRoute } from "@tanstack/react-router";
import { everrVersion } from "#app/version.ts";

export const Route = createFileRoute("/api/health")({
  server: {
    handlers: {
      GET: async () =>
        Response.json({
          ok: true,
          version: everrVersion,
        }),
    },
  },
});
