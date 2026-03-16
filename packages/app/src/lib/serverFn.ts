import { createMiddleware, createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { getAccessTokenSessionFromRequest, getWorkOSAuthSession } from "./auth";

const authMiddleware = createMiddleware({ type: "function" }).server(
  async ({ next }) => {
    const request = getRequest();
    const accessTokenSession = await getAccessTokenSessionFromRequest(request);

    if (accessTokenSession) {
      return next({
        context: {
          session: accessTokenSession,
        },
      });
    }

    const workOSAuthSession = await getWorkOSAuthSession();

    if (workOSAuthSession) {
      return next({
        context: {
          session: workOSAuthSession,
        },
      });
    }

    throw new Error("Unauthenticated");
  },
);

export const createAuthenticatedServerFn = createServerFn().middleware([
  authMiddleware,
]);
