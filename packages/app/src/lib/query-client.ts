import { MutationCache, type Query, QueryCache, QueryClient } from "@tanstack/react-query";
import type { AnyRouter } from "@tanstack/react-router";
import { isAuthFailure } from "#app/lib/auth-failure.ts";
import { applyAccessChange, isRouteAccessQuery } from "#app/lib/route-access-cache.ts";

// A page whose data keeps failing after the guards let it through again (the
// guards and the server disagree) would otherwise re-run them on every failure.
const AUTH_FAILURE_COOLDOWN_MS = 10_000;

export function createQueryClient(router: () => Pick<AnyRouter, "invalidate" | "navigate">) {
  // Route guards keep their data until something resets it, so a session that
  // ends elsewhere (signed out in another tab, expired, revoked) or a removed
  // membership first shows up as a failed data request. Dropping the guard
  // data and re-running the guards sends the user to sign-in, to pick a
  // workspace, to the suspended organization's billing, or on to the
  // organization the session moved to, with the current page as the return
  // destination where there is one.
  let handledAt = -Infinity;
  const onAuthFailure = (error: unknown, query?: Pick<Query, "queryKey">) => {
    // Guards handle their own failures (`ensureRouteAccess`).
    if (!isAuthFailure(error) || (query && isRouteAccessQuery(query))) return;
    // Many requests fail together when a session ends; one re-run covers them.
    if (Date.now() - handledAt < AUTH_FAILURE_COOLDOWN_MS) return;
    handledAt = Date.now();
    void applyAccessChange(queryClient, router());
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
