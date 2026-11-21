import { type Query, type QueryClient, queryOptions } from "@tanstack/react-query";
import type { AnyRouter } from "@tanstack/react-router";
import type { RootAccess } from "#app/routes/__root.tsx";

const ROUTE_ACCESS_KEY = "route-access";

/**
 * Options for the data route guards read. TanStack Router runs every matched
 * `beforeLoad` on every navigation, search-only ones included, so guards read
 * it with `ensureQueryData` instead of calling the server each time.
 *
 * The data changes only on events this app sees (sign-in, switching or
 * creating an organization, finishing setup, billing changes), which call
 * `resetRouteAccess`, or when a data request fails with an auth error, which
 * `createQueryClient` turns into the same reset. Nothing time-based
 * should refetch it, hence `"static"`: blanket refetches such as the refresh
 * button's skip it. The server checks auth on every data request regardless;
 * these guards only decide where to route.
 */
export function routeAccessQuery<T>(key: readonly unknown[], queryFn: () => Promise<T>) {
  return queryOptions({
    queryKey: [ROUTE_ACCESS_KEY, ...key],
    queryFn,
    staleTime: "static",
    gcTime: Infinity,
    retry: false,
  });
}

export function isRouteAccessQuery(query: Pick<Query, "queryKey">) {
  return query.queryKey[0] === ROUTE_ACCESS_KEY;
}

/** Call after anything that changes the session, the active organization, or its access. */
export function resetRouteAccess(queryClient: QueryClient) {
  queryClient.removeQueries({ queryKey: [ROUTE_ACCESS_KEY] });
}

/**
 * Moves the open page to a changed session or active organization. Data keys
 * do not include the organization, so the previous one's data must not show.
 */
export async function applyAccessChange(
  queryClient: QueryClient,
  router: Pick<AnyRouter, "invalidate" | "navigate">,
  returnTo?: string,
) {
  resetRouteAccess(queryClient);
  // Stop previous organization requests from repopulating the shared cache.
  await queryClient.cancelQueries();
  queryClient.removeQueries({ type: "inactive" });
  // Mark what is on screen stale, then let the guards redirect before refetching it.
  await queryClient.invalidateQueries({ refetchType: "none" });
  if (returnTo === undefined) await router.invalidate();
  else await router.navigate({ href: returnTo, replace: true });
  await queryClient.refetchQueries({ type: "active" });
}

function identityOf(context: RootAccess["context"]) {
  const session = context?.session;
  return session
    ? `${session.user.id}:${session.session.id}:${session.session.activeOrganizationId ?? ""}`
    : "";
}

/**
 * Every tab shares one session, active organization included, so signing in as
 * someone else or switching organization in another tab changes what this
 * tab's data requests return without resetting its guards. Call when the tab
 * comes back to the front.
 */
export async function revalidateRootAccess(
  queryClient: QueryClient,
  router: Pick<AnyRouter, "invalidate" | "navigate">,
  fetchContext: () => Promise<RootAccess["context"]>,
) {
  const current = await fetchContext();
  // Read after the request: a change made in this tab meanwhile already reset it.
  const cached = queryClient.getQueryData<RootAccess["context"]>([
    ROUTE_ACCESS_KEY,
    ...rootContextKey,
  ]);
  if (!cached || identityOf(cached) === identityOf(current)) return;
  await applyAccessChange(queryClient, router);
}

export const rootContextKey = ["root"] as const;
export const entryRedirectKey = (pathname: string) => ["entry", pathname] as const;

// The root guard runs on the server for the page shell, and hydration reuses
// its result instead of running it again in the browser. Handing over what it
// read keeps the first navigation after a page load from asking again. The
// server's QueryClient belongs to this one request, so this only ever carries
// the requesting user's own session back to them.
export function dehydrateRootAccess(queryClient: QueryClient, pathname: string): RootAccess {
  return {
    pathname,
    context: queryClient.getQueryData<RootAccess["context"]>([ROUTE_ACCESS_KEY, ...rootContextKey]),
    entryRedirect: queryClient.getQueryData<RootAccess["entryRedirect"]>([
      ROUTE_ACCESS_KEY,
      ...entryRedirectKey(pathname),
    ]),
  };
}

export function hydrateRootAccess(
  queryClient: QueryClient,
  { pathname, context, entryRedirect }: RootAccess,
) {
  if (context) queryClient.setQueryData([ROUTE_ACCESS_KEY, ...rootContextKey], context);
  if (entryRedirect !== undefined)
    queryClient.setQueryData([ROUTE_ACCESS_KEY, ...entryRedirectKey(pathname)], entryRedirect);
}
