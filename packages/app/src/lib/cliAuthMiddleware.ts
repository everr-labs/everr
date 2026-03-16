import { createMiddleware } from "@tanstack/react-start";
import { getAccessTokenSessionFromRequest } from "./auth";
import { createAuthContext } from "./auth-context";

export const cliAuthMiddleware = createMiddleware({
  type: "request",
}).server(async ({ next, request }) => {
  const accessTokenSession = await getAccessTokenSessionFromRequest(request);

  if (!accessTokenSession) {
    return Response.json(
      {
        error: "You need to be authenticated to use this API",
      },
      { status: 401 },
    );
  }

  return next({
    context: createAuthContext(accessTokenSession),
  });
});
