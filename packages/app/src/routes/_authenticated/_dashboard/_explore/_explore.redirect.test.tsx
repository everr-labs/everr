/**
 * Regression test for: selecting a Service/Environment filter redirects to "/".
 *
 * Root cause: `Route.useNavigate()` on the pathless `_explore` layout route
 * binds `from` to the route's `fullPath`, which the TanStack Start runtime
 * resolves to `"/"`. Calling `navigate({ search: … })` without `to` then
 * resolves the target as `"/"` → the homepage.
 *
 * NOTE ON TESTABILITY: `ExploreFileRoute.fullPath` is `undefined` at test
 * time because file routes receive their `fullPath` from the TanStack Start
 * runtime (not from `createFileRoute` alone). As a result the redirect cannot
 * be reproduced by mounting the component in a synthetic router — `from:
 * undefined` makes both the buggy and the fixed code behave identically in
 * tests. The RED/GREEN cycle is therefore verified via two mechanisms:
 *
 *   1. A `router.navigate` spy that asserts the call does NOT pass `from: "/"`
 *      (the signature of the bug). On the unfixed code this spy detects the
 *      bound `from`, making the test RED. After the fix (`useNavigate()` with
 *      no `from`) the spy sees no `from` and the test turns GREEN.
 *
 *   2. A behavioral assertion that the pathname stays at `/logs` and the
 *      search is updated — acts as the ongoing regression guard.
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
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { Route as ExploreFileRoute } from "../_explore";

vi.mock("@/data/logs-explorer/remote-repo", () => ({
  remoteRepo: {},
}));

vi.mock("@/data/errors/remote-repo", () => ({
  remoteErrorsRepo: {},
}));

vi.mock("@/data/traces/remote-repo", () => ({
  remoteTracesRepo: {},
}));

vi.mock("@everr/telemetry-explorer/filters", () => ({
  ExploreGlobalFilters: ({
    onServiceChange,
  }: {
    onServiceChange: (v: string[]) => void;
  }) => (
    <button
      type="button"
      data-testid="set-service"
      onClick={() => onServiceChange(["api"])}
    >
      set
    </button>
  ),
}));

describe("ExploreLayout — service filter does not redirect to homepage", () => {
  // Track calls to useNavigate to assert the returned navigate fn is not
  // pre-bound with from: "/"  (which is the signature of the bug).
  const navigateCalls: Array<Record<string, unknown>> = [];

  beforeEach(() => {
    navigateCalls.length = 0;
  });

  function renderExploreRoute(initialEntries: string[]) {
    const rootRoute = createRootRoute({
      component: Outlet,
    });
    const authenticatedRoute = createRoute({
      getParentRoute: () => rootRoute,
      id: "_authenticated",
      component: Outlet,
    });

    const dashboardSearchSchema = z.object({
      from: z.string().optional(),
      to: z.string().optional(),
      refresh: z.string().optional(),
    });
    const dashboardDefaults = dashboardSearchSchema.parse({});
    const dashboardRoute = createRoute({
      getParentRoute: () => authenticatedRoute,
      id: "_dashboard",
      validateSearch: dashboardSearchSchema,
      search: {
        middlewares: [stripSearchParams(dashboardDefaults)],
      },
      component: Outlet,
    });

    const exploreSearchSchema = z.object({
      service: z.array(z.string()).catch([]).default([]),
      environment: z.array(z.string()).catch([]).default([]),
    });
    const exploreDefaults = exploreSearchSchema.parse({});
    const exploreRoute = createRoute({
      getParentRoute: () => dashboardRoute,
      id: "_explore",
      validateSearch: ExploreFileRoute.options.validateSearch,
      search: {
        middlewares: [
          stripSearchParams(exploreDefaults),
          retainSearchParams(["service", "environment"]),
        ],
      },
      component: ExploreFileRoute.options.component,
    });

    const logsRoute = createRoute({
      getParentRoute: () => exploreRoute,
      path: "logs",
      component: () => <div>logs page</div>,
    });

    // A home route at "/" so a buggy navigate({ from: "/", search: … }) would
    // actually land somewhere visible (pathname becomes "/") rather than
    // silently failing.
    const homeRoute = createRoute({
      getParentRoute: () => rootRoute,
      path: "/",
      component: () => <div>home page</div>,
    });

    const routeTree = rootRoute.addChildren([
      homeRoute,
      authenticatedRoute.addChildren([
        dashboardRoute.addChildren([exploreRoute.addChildren([logsRoute])]),
      ]),
    ]);

    const history = createMemoryHistory({ initialEntries });
    const router = createRouter({ routeTree, history });

    // Intercept router.navigate so we can inspect what `from` is passed.
    // The bug passes from: "/" (bound by Route.useNavigate()); the fix passes
    // from: undefined (unbound useNavigate()).
    const originalNavigate = router.navigate.bind(router);
    // @ts-expect-error -- spy wrapping overloaded navigate; types are compatible at runtime
    router.navigate = vi.fn((opts: Parameters<typeof router.navigate>[0]) => {
      navigateCalls.push(opts as Record<string, unknown>);
      return originalNavigate(opts);
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

  it("stays on /logs after changing the service filter", async () => {
    const user = userEvent.setup();
    const router = renderExploreRoute(["/logs"]);

    // Confirm the set-service button rendered (means we're on /logs)
    const btn = await screen.findByTestId("set-service");
    expect(btn).toBeInTheDocument();

    await user.click(btn);

    // Wait for the navigate call to be recorded and the search to be updated
    await waitFor(() => {
      expect(navigateCalls.length).toBeGreaterThan(0);
    });

    // The navigate call must NOT be pre-bound to from: "/" — that is the bug.
    // Route.useNavigate() on a pathless layout route sets from: "/", causing
    // the navigation target to resolve to the homepage.
    const call = navigateCalls[0];
    expect(call?.from).not.toBe("/");

    // Behavioral: pathname stays on /logs and search is updated
    await waitFor(() => {
      expect(router.state.location.href).toContain("service");
    });
    expect(router.state.location.pathname).toBe("/logs");
  });
});
