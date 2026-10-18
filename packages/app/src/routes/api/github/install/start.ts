import { createFileRoute } from "@tanstack/react-router";
import { handleInstallStart } from "#app/integrations/github/install-start.ts";

export const Route = createFileRoute("/api/github/install/start")({
  server: { handlers: { GET: ({ request }) => handleInstallStart(request) } },
});
