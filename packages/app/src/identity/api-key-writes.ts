import type { BetterAuthPlugin } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";

// Everr creates keys only through its own server function, which validates
// public-key metadata and picks the key config. better-auth also serves create
// and update over HTTP, where an admin could set any metadata: turn a public
// key into a secret one, or widen its allowed origins. Matching on the routed
// endpoint path (not the raw URL) also covers `//api-key/update` and trailing
// slashes. Server-side `auth.api` calls carry no request and stay allowed.
const SERVER_ONLY_PATHS = new Set(["/api-key/create", "/api-key/update"]);

export function apiKeyServerOnlyWritesPlugin(): BetterAuthPlugin {
  return {
    id: "api-key-server-only-writes",
    hooks: {
      before: [
        {
          matcher: (ctx) => ctx.request !== undefined && SERVER_ONLY_PATHS.has(ctx.path ?? ""),
          handler: createAuthMiddleware(async () => {
            throw new APIError("NOT_FOUND");
          }),
        },
      ],
    },
  };
}
