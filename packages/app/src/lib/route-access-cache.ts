import { appQueryOptions } from "@everr/ui/lib/query-options";
import type { Query, QueryClient } from "@tanstack/react-query";
import { type AnyRouter, redirect } from "@tanstack/react-router";
import { isAuthFailure } from "#app/lib/auth-failure.ts";
import type { RootContext } from "#app/routes/__root.tsx";

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
  return appQueryOptions({
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

// Keyed by the session too, so a missed reset can never hand one session's
// organization to another.
export const organizationAccessKey = (session: {
  session: { id: string; activeOrganizationId?: string | null };
}) => ["organization", session.session.id, session.session.activeOrganizationId ?? null] as const;

const GUARD_RETRY_COOLDOWN_MS = 10_000;
const guardRetriedAt = new WeakMap<QueryClient, number>();

/**
 * `ensureQueryData` for a route guard. When the read fails because the session
 * or organization changed, starting the navigation over with fresh access
 * (the root's session included) sends the user where they now belong:
 * sign-in, another workspace, or billing. At most once per cooldown, so a
 * server that keeps refusing shows its error instead of redirecting forever.
 */
export async function ensureRouteAccess<T>(
  queryClient: QueryClient,
  options: ReturnType<typeof routeAccessQuery<T>>,
  href: string,
): Promise<T> {
  try {
    return await queryClient.ensureQueryData(options);
  } catch (error) {
    const retriedAt = guardRetriedAt.get(queryClient) ?? -Infinity;
    if (!isAuthFailure(error) || Date.now() - retriedAt < GUARD_RETRY_COOLDOWN_MS) throw error;
    guardRetriedAt.set(queryClient, Date.now());
    resetRouteAccess(queryClient);
    throw redirect({ href, replace: true });
  }
}

/**
 * Reads guard data from the server again. It only changes through resets this
 * tab makes, so a change made elsewhere (a restored subscription, a promotion)
 * leaves it stale. Allowing on stale data is harmless, since the server checks
 * every request, but refusing is not: a guard about to refuse calls this first.
 * Undefined when nothing is cached or the read fails.
 */
export async function refetchRouteAccess<T>(
  queryClient: QueryClient,
  key: readonly unknown[],
): Promise<T | undefined> {
  const query = queryClient
    .getQueryCache()
    .find<T>({ queryKey: [ROUTE_ACCESS_KEY, ...key], exact: true });
  try {
    return await query?.fetch();
  } catch {
    return undefined;
  }
}

/** Call after anything that changes the session, the active organization, or its access. */
export function resetRouteAccess(queryClient: QueryClient) {
  queryClient.removeQueries({ queryKey: [ROUTE_ACCESS_KEY] });
}

/**
 * Forgets what the previous session or organization allowed and showed: guard
 * data, and cached page data, whose keys do not include the organization.
 * Enough on its own for a page that shows nothing organization-specific.
 */
export async function forgetAccess(queryClient: QueryClient) {
  resetRouteAccess(queryClient);
  // Stop previous organization requests from repopulating the shared cache.
  await queryClient.cancelQueries();
  queryClient.removeQueries({ type: "inactive" });
  // Mark what is on screen stale; `applyAccessChange` refetches it after the guards.
  await queryClient.invalidateQueries({ refetchType: "none" });
}

/** Moves the open page to a changed session or active organization. */
export async function applyAccessChange(
  queryClient: QueryClient,
  router: Pick<AnyRouter, "invalidate" | "navigate">,
  returnTo?: string,
) {
  await forgetAccess(queryClient);
  // Let the guards redirect before refetching what is on screen.
  if (returnTo === undefined) await router.invalidate();
  else await router.navigate({ href: returnTo, replace: true });
  await queryClient.refetchQueries({ type: "active" });
}

function identityOf(context: RootContext | undefined) {
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
  fetchContext: () => Promise<RootContext | undefined>,
) {
  const current = await fetchContext();
  // Read after the request: a change made in this tab meanwhile already reset it.
  const cached = queryClient.getQueryData<RootContext | undefined>([
    ROUTE_ACCESS_KEY,
    ...rootContextKey,
  ]);
  if (!cached || identityOf(cached) === identityOf(current)) return;
  await applyAccessChange(queryClient, router);
}

export const rootContextKey = ["root"] as const;
