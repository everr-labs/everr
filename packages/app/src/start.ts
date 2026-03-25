import { createMiddleware, createStart } from "@tanstack/react-start";
import {
  type AuthResult,
  authkitMiddleware,
  type CustomClaims,
} from "@workos/authkit-tanstack-react-start";

const prerenderingAuthKitMiddleware = createMiddleware({
  type: "request",
}).server(async ({ next, request }) => {
  return next({
    context: {
      auth: () => ({ user: null }),
      __setPendingHeader: () => {},
      redirectUri: undefined,
      request,
    } satisfies {
      auth: () => AuthResult<CustomClaims>;
      request: Request;
      redirectUri: string | undefined;
      __setPendingHeader: (key: string, value: string) => void;
    },
  });
});

export const startInstance = createStart(() => ({
  requestMiddleware: process.env.BUILD
    ? [prerenderingAuthKitMiddleware]
    : [authkitMiddleware()],
}));
