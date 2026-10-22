import { createFileRoute } from "@tanstack/react-router";
import { handleInstallCallback } from "#app/integrations/github/install-callback.ts";

export const Route = createFileRoute("/api/github/install/callback")({
  server: {
    handlers: { GET: ({ request }) => handleInstallCallback(request) },
  },
});
