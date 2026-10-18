import { createFileRoute } from "@tanstack/react-router";
import { handleGitHubWebhookRequest } from "#app/server/github-events/webhook.ts";

export const Route = createFileRoute("/webhook/github")({
  server: {
    handlers: ({ createHandlers }) =>
      createHandlers({
        GET: async () => new Response("method not allowed", { status: 405 }),
        POST: async ({ request }) => handleGitHubWebhookRequest(request),
      }),
  },
});
