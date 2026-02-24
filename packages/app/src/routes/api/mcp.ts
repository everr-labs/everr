import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createFileRoute } from "@tanstack/react-router";
import { createMiddleware } from "@tanstack/react-start";
import { getBearerToken, validateMcpApiKey } from "@/lib/mcp-auth";
import { setRequestContextInStartContext } from "@/lib/start-context";
import { createMcpServer } from "@/mcp/server";

const tokenAuthMiddleware = createMiddleware({ type: "request" }).server(
  async ({ next, request }) => {
    const token = getBearerToken(request.headers);

    if (!token) {
      return Response.json(
        {
          error: "Missing Bearer token. Generate an MCP API token in Citric.",
        },
        { status: 401 },
      );
    }

    const validatedApiKey = await validateMcpApiKey(token);
    if (!validatedApiKey) {
      return Response.json(
        {
          error:
            "Invalid API token. Ensure the token is active and generated from MCP Server setup.",
        },
        { status: 401 },
      );
    }

    setRequestContextInStartContext({
      organizationId: validatedApiKey.organizationId,
      userId: validatedApiKey.userId,
      tenantId: validatedApiKey.tenantId,
    });

    return next({
      context: {
        apiKey: validatedApiKey,
      },
    });
  },
);

export const Route = createFileRoute("/api/mcp")({
  server: {
    middleware: [tokenAuthMiddleware],
    handlers: {
      POST: async ({ request }) => {
        const transport = new WebStandardStreamableHTTPServerTransport({
          sessionIdGenerator: undefined,
          enableJsonResponse: true,
        });

        const server = createMcpServer();
        await server.connect(transport);

        try {
          const response = await transport.handleRequest(request);
          return response;
        } catch (error) {
          console.error("[mcp] request_failed", {
            error,
          });
          throw error;
        } finally {
          await server.close();
          await transport.close();
        }
      },
    },
  },
});
