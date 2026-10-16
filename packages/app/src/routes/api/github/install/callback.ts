import { createFileRoute } from "@tanstack/react-router";
import { handleInstallCallback } from "@/integrations/github/install-callback";

export const Route = createFileRoute("/api/github/install/callback")({
  server: {
    handlers: { GET: ({ request }) => handleInstallCallback(request) },
  },
});
