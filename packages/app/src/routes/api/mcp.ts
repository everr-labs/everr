import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/mcp")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { handleMcpRequest } = await import("@/mcp/handler");
        return handleMcpRequest(request);
      },
    },
  },
});
