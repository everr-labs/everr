import { createMiddleware } from "@tanstack/react-start";
import { getBearerToken, validateCliAuthToken } from "@/lib/cli-auth";
import { setRequestContextInStartContext } from "@/lib/start-context";

export const cliAuthMiddleware = createMiddleware({
  type: "request",
}).server(async ({ next, request }) => {
  const token = getBearerToken(request.headers);

  if (!token) {
    return Response.json(
      {
        error: "Missing Bearer token. Run `everr login` and retry.",
      },
      { status: 401 },
    );
  }

  const validatedAuth = await validateCliAuthToken(token);
  if (!validatedAuth) {
    return Response.json(
      {
        error: "Invalid token. Run `everr login` again and retry.",
      },
      { status: 401 },
    );
  }

  setRequestContextInStartContext({
    organizationId: validatedAuth.organizationId,
    userId: validatedAuth.userId,
    tenantId: validatedAuth.tenantId,
  });

  return next({
    context: {
      auth: validatedAuth,
    },
  });
});
