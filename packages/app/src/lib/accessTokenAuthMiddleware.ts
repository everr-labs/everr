import { createMiddleware } from "@tanstack/react-start";
import { setRequestContextInStartContext } from "@/lib/start-context";
import { getAccessTokenSessionFromRequest } from "./auth";

export const accessTokenAuthMiddleware = createMiddleware({
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

  setRequestContextInStartContext(accessTokenSession);

  return next({
    context: {
      session: accessTokenSession,
    },
  });
});
