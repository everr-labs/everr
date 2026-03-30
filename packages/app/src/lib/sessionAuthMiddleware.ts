import { createMiddleware } from "@tanstack/react-start";
import { getWorkOSAuthSession } from "./auth";
import { createAuthContext } from "./auth-context";

export const sessionAuthMiddleware = createMiddleware({
  type: "request",
}).server(async ({ next }) => {
  const session = await getWorkOSAuthSession();

  if (!session) {
    return Response.json(
      { error: "You need to be authenticated to use this API" },
      { status: 401 },
    );
  }

  return next({
    context: createAuthContext(session),
  });
});
