import { createMiddleware, createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { getAuth } from "@workos/authkit-tanstack-react-start";
import { getBearerToken } from "./access-token-auth";
import { validateCliAuthToken } from "./cli-auth";

const authMiddleware = createMiddleware({ type: "function" }).server(
  async ({ next }) => {
    const request = getRequest();
    const token = getBearerToken(request.headers);

    if (token) {
      const auth = await validateCliAuthToken(token);

      if (auth) {
        return next({
          context: {
            session: {
              userId: auth.userId,
              organizationId: auth.organizationId,
              sessionId: undefined as string | undefined,
            },
          },
        });
      }
    }

    const auth = await getAuth();

    if (!auth.user) {
      throw new Error("Unauthenticated");
    }
    if (!auth.organizationId) {
      throw new Error("Missing organization");
    }

    return next({
      context: {
        session: {
          userId: auth.user.id,
          organizationId: auth.organizationId,
          sessionId: auth.sessionId as string | undefined,
        },
      },
    });
  },
);

export const createAuthenticatedServerFn = createServerFn().middleware([
  authMiddleware,
]);
