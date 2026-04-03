import { createMiddleware } from "@tanstack/react-start";
import { getAccessTokenSessionFromRequest, getWorkOSAuthSession } from "./auth";
import { createAuthContext } from "./auth-context";

export const anyAuthMiddleware = createMiddleware({
  type: "request",
}).server(async ({ next, request }) => {
  const session =
    (await getAccessTokenSessionFromRequest(request)) ??
    (await getWorkOSAuthSession());

  if (!session) {
    return Response.json(
      {
        error: "You need to be authenticated to use this API",
      },
      { status: 401 },
    );
  }

  return next({
    context: createAuthContext(session),
  });
});
