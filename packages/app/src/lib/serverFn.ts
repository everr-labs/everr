import { createMiddleware, createServerFn } from "@tanstack/react-start";
import { getAuth } from "@workos/authkit-tanstack-react-start";

const authMiddleware = createMiddleware({ type: "function" }).server(
  async ({ next }) => {
    const auth = await getAuth();
    if (!auth.user) {
      throw new Error("Unauthenticated");
    }
    if (!auth.organizationId) {
      throw new Error("Missing organization");
    }

    return next({
      context: {
        auth: {
          ...auth,
          organizationId: auth.organizationId,
        },
      },
    });
  },
);

export const createAuthenticatedServerFn = createServerFn().middleware([
  authMiddleware,
]);
