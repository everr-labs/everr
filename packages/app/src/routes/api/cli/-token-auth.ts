import { createMiddleware } from "@tanstack/react-start";
import { getBearerToken, validateAccessToken } from "@/lib/access-token-auth";
import { setRequestContextInStartContext } from "@/lib/start-context";

export const cliTokenAuthMiddleware = createMiddleware({
  type: "request",
}).server(async ({ next, request }) => {
  const token = getBearerToken(request.headers);

  if (!token) {
    return Response.json(
      {
        error: "Missing Bearer token. Generate a token in Everr and retry.",
      },
      { status: 401 },
    );
  }

  const validatedApiKey = await validateAccessToken(token);
  if (!validatedApiKey) {
    return Response.json(
      {
        error:
          "Invalid token. Ensure the token is active and generated from MCP Server setup.",
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
});
