/**
 * Regression test for: clearing a Service/Environment filter back to empty must
 * remove it from the URL, not silently re-apply the previous value.
 *
 * The Explore filters are persisted with `retainSearchParams` (so sidebar /
 * cross-section navigation keeps them) and cleaned up with `stripSearchParams`
 * (so the default empty array stays out of the URL). The two only coexist when
 * the schemas are OPTIONAL (no `.default([])`):
 *
 *   - cross-route nav: the key arrives absent, retain copies the live value;
 *   - explicit clear (service: []): the value is present, strip drops it as a
 *     default and retain — which only refills absent keys — leaves it gone.
 *
 * With a schema default, every destination already carries `[]`, retain can
 * never fire (persistence breaks) AND a strip-then-retain re-injects a cleared
 * value (clears never stick). This test reconstructs the real middleware chain
 * and exercises set / clear / cross-route persistence end to end.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
  retainSearchParams,
  stripSearchParams,
} from "@tanstack/react-router";
import { render, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vite-plus/test";
import { z } from "zod";
import { ExploreSearchRetainShape, ExploreSearchShape } from "@/lib/explore-search";

function buildRouter(initialEntries: string[]) {
  const rootRoute = createRootRoute({ component: Outlet });
  const authenticatedRoute = createRoute({
    getParentRoute: () => rootRoute,
    id: "_authenticated",
    component: Outlet,
  });

  // Mirrors _dashboard.tsx: strip THEN retain for service/environment.
  const dashboardRoute = createRoute({
    getParentRoute: () => authenticatedRoute,
    id: "_dashboard",
    validateSearch: z.object({
      from: z.string().optional(),
      to: z.string().optional(),
      refresh: z.string().optional(),
      ...ExploreSearchRetainShape,
    }),
    search: {
      middlewares: [
        stripSearchParams({ service: [], environment: [] }),
        retainSearchParams(["from", "to", "refresh", "service", "environment"]),
      ],
    },
    component: Outlet,
  });

  // Mirrors _explore.tsx: validateSearch only, no middleware.
  const exploreRoute = createRoute({
    getParentRoute: () => dashboardRoute,
    id: "_explore",
    validateSearch: z.object(ExploreSearchShape),
    component: Outlet,
  });

  // Mirrors logs.tsx / errors.tsx: child schema spreads the (optional) shape.
  const logsRoute = createRoute({
    getParentRoute: () => exploreRoute,
    path: "logs",
    validateSearch: z.object({ ...ExploreSearchShape }),
    component: () => <div>logs</div>,
  });
  const errorsRoute = createRoute({
    getParentRoute: () => exploreRoute,
    path: "errors",
    validateSearch: z.object({ ...ExploreSearchShape }),
    component: () => <div>errors</div>,
  });

  const routeTree = rootRoute.addChildren([
    authenticatedRoute.addChildren([
      dashboardRoute.addChildren([exploreRoute.addChildren([logsRoute, errorsRoute])]),
    ]),
  ]);

  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries }),
  });
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

const serviceOf = (router: ReturnType<typeof buildRouter>) =>
  (router.state.location.search as { service?: string[] }).service;

// The synthetic router's fully-typed `navigate` demands route-specific search
// args; this test drives it route-agnostically (mirroring how the app updates
// shared params), so narrow to a loose, non-`any` signature.
type LooseNavigate = (opts: {
  to: string;
  search?: (prev: Record<string, unknown>) => Record<string, unknown>;
}) => Promise<void>;
const navTo = (router: ReturnType<typeof buildRouter>) =>
  router.navigate as unknown as LooseNavigate;

describe("explore filter clear + persistence", () => {
  it("keeps an explicitly set service in the URL", async () => {
    const router = buildRouter(['/logs?service=["alert"]']);
    await waitFor(() => expect(serviceOf(router)).toEqual(["alert"]));
  });

  it("removes service from the URL when cleared back to empty", async () => {
    const router = buildRouter(['/logs?service=["alert"]']);
    await waitFor(() => expect(serviceOf(router)).toEqual(["alert"]));

    await navTo(router)({
      to: "/logs",
      search: (prev) => ({ ...prev, service: [] }),
    });

    await waitFor(() => expect(serviceOf(router)).toBeUndefined());
    expect(router.state.location.pathname).toBe("/logs");
  });

  it("retains service across cross-section navigation", async () => {
    const router = buildRouter(['/logs?service=["alert"]']);
    await waitFor(() => expect(serviceOf(router)).toEqual(["alert"]));

    await navTo(router)({ to: "/errors" });

    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/errors");
      expect(serviceOf(router)).toEqual(["alert"]);
    });
  });
});
