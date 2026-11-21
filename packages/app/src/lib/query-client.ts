import { MutationCache, type Query, QueryCache, QueryClient } from "@tanstack/react-query";
import { isRouteAccessQuery, resetRouteAccess } from "#app/lib/route-access-cache.ts";

// The messages `AuthError` (org-session.server.ts) and `NotOrganizationAdminError`
// carry. Server function errors reach the browser as plain `Error`s, so the
// message is what survives.
const AUTH_FAILURES = new Set([
  "Unauthenticated",
  "No active organization",
  "Not a member of the active organization",
  "Organization suspended",
  "Not authorized",
]);

// A page whose data keeps failing after the guards let it through again (the
// guards and the server disagree) would otherwise re-run them on every failure.
const AUTH_FAILURE_COOLDOWN_MS = 10_000;

/**
 * The session ended, the user lost the active organization or their admin
 * role, or the subscription was suspended. Retrying cannot fix any of them.
 */
function isAuthFailure(error: unknown) {
  return error instanceof Error && AUTH_FAILURES.has(error.message);
}

export function createQueryClient(router: () => { invalidate: () => Promise<void> }) {
  // Route guards keep their data until something resets it, so a session that
  // ends elsewhere (signed out in another tab, expired, revoked) or a removed
  // membership first shows up as a failed data request. Dropping the guard
  // data and re-running the guards sends the user to sign-in, to pick a
  // workspace, or to the suspended organization's billing, with the current
  // page as the return destination where there is one.
  let handledAt = -Infinity;
  const onAuthFailure = (error: unknown, query?: Pick<Query, "queryKey">) => {
    // A guard's own failure already surfaces through the router; re-running the
    // guards from it could loop.
    if (!isAuthFailure(error) || (query && isRouteAccessQuery(query))) return;
    // Many requests fail together when a session ends; one re-run covers them.
    if (Date.now() - handledAt < AUTH_FAILURE_COOLDOWN_MS) return;
    handledAt = Date.now();
    resetRouteAccess(queryClient);
    void router().invalidate();
  };

  const queryClient: QueryClient = new QueryClient({
    queryCache: new QueryCache({ onError: (error, query) => onAuthFailure(error, query) }),
    mutationCache: new MutationCache({ onError: (error) => onAuthFailure(error) }),
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        gcTime: 5 * 60_000,
        refetchOnWindowFocus: true,
        retry: (failureCount, error) => !isAuthFailure(error) && failureCount < 3,
      },
    },
  });
  return queryClient;
}
