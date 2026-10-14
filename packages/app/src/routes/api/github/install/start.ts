import { createFileRoute } from "@tanstack/react-router";
import { handleInstallStart } from "@/integrations/github/install-start";

export const Route = createFileRoute("/api/github/install/start")({
  server: { handlers: { GET: ({ request }) => handleInstallStart(request) } },
});
