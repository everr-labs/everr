import { createFileRoute } from "@tanstack/react-router";
import { handleGitHubWebhookRequest } from "@/integrations/github/events/webhook";

export const Route = createFileRoute("/webhook/github")({
  server: {
    handlers: ({ createHandlers }) =>
      createHandlers({
        GET: async () => new Response("method not allowed", { status: 405 }),
        POST: async ({ request }) => handleGitHubWebhookRequest(request),
      }),
  },
});
