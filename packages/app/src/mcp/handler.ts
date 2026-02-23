import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { getBearerToken, validateMcpApiKey } from "@/lib/mcp-auth";
import { setRequestContextInStartContext } from "@/lib/start-context";
import { createMcpServer } from "./server";

export async function handleMcpRequest(request: Request): Promise<Response> {
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

  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });

  const server = createMcpServer();
  await server.connect(transport);

  try {
    setRequestContextInStartContext({
      organizationId: validatedApiKey.organizationId,
      userId: validatedApiKey.userId,
    });

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
}
