import type { BetterAuthPlugin } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { isServiceAccountToken } from "./service-account-credentials";
import { deleteToken, findLiveToken } from "./service-account-store";

// `/organization/leave` deletes the caller's own member row through the
// adapter, and the organization plugin has no before-hook on that path. A
// service account that leaves keeps its secrets, its tokens, and its user
// row, but drops off the Service accounts list, so it can never be deleted
// through the UI while its secrets still exchange for working tokens.
// Leaving is a human action, so the path is refused rather than guarded.
const REFUSED_PATH = "/organization/leave";

// `/delete-user` is enabled in our configuration and has no guard here on
// purpose: better-auth closes it for us. Its `sensitiveSessionMiddleware`
// drops `ctx.context.session` and re-reads the session from the session
// store, and a service-account session has no row there, so the call is
// refused before the handler runs. Nothing in this repository holds that
// door shut, which is why service-account-contract.test.ts calls
// `/delete-user` against a real better-auth instance: an upgrade that made
// that middleware trust the session already in context would open the path
// with no other sign.

function bearerToken(headers: Headers | undefined): string | null {
  const value = headers?.get("authorization");
  if (!value?.startsWith("Bearer ")) {
    return null;
  }
  const token = value.slice("Bearer ".length);
  return isServiceAccountToken(token) ? token : null;
}

export async function resolveServiceAccountSession(tokenValue: string) {
  if (!isServiceAccountToken(tokenValue)) {
    return null;
  }

  const row = await findLiveToken(tokenValue);
  if (!row) {
    return null;
  }

  if (row.expiresAt.getTime() <= Date.now()) {
    // An agent that keeps exchanging cleans up after itself, so expired rows
    // never need a sweeper.
    await deleteToken(row.id);
    return null;
  }

  // `last_used_at` is stamped by the exchange, not here. Stamping on every
  // authenticated request costs two UPDATEs per server function, and hourly
  // granularity is all a noticeable leak needs.
  return {
    user: row.user,
    session: {
      id: row.id,
      token: tokenValue,
      userId: row.user.id,
      createdAt: new Date(),
      updatedAt: new Date(),
      // The lifetime lives on the token row. Better Auth has no per-session
      // expiry and rolls sessions on use, which is why no session row exists.
      expiresAt: row.expiresAt,
      activeOrganizationId: row.organizationId,
    },
  };
}

export function serviceAccountPlugin(): BetterAuthPlugin {
  return {
    id: "service-account",
    hooks: {
      before: [
        {
          matcher: (ctx) => bearerToken(ctx.headers) !== null,
          handler: createAuthMiddleware(async (ctx) => {
            const token = bearerToken(ctx.headers);
            if (!token) {
              return;
            }

            const session = await resolveServiceAccountSession(token);
            if (!session) {
              return;
            }

            if (ctx.path === REFUSED_PATH) {
              throw new APIError("FORBIDDEN", {
                message:
                  "A service account cannot leave an organization. Delete the service account instead.",
              });
            }

            ctx.context.session = session as never;
            if (ctx.path === "/get-session") {
              return session;
            }
            return { context: ctx };
          }),
        },
      ],
    },
  };
}
