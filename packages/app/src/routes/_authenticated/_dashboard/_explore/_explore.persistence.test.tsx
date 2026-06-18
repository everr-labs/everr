import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Link,
  Outlet,
  RouterProvider,
  retainSearchParams,
  stripSearchParams,
  useSearch,
} from "@tanstack/react-router";
import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { z } from "zod";

// TanStack Router JSON-encodes array search params: service=["api"] (percent-encoded)
const INITIAL_URL =
  "/logs?service=%5B%22api%22%5D&environment=%5B%22prod%22%5D";

const exploreSearchSchema = z.object({
  service: z.array(z.string()).catch([]).default([]),
  environment: z.array(z.string()).catch([]).default([]),
});
const exploreDefaults = exploreSearchSchema.parse({});

describe("_explore search param persistence across sibling routes", () => {
  function buildExploreRouter() {
    const rootRoute = createRootRoute({ component: Outlet });
    const authenticatedRoute = createRoute({
      getParentRoute: () => rootRoute,
      id: "_authenticated",
      component: Outlet,
    });
    const dashboardRoute = createRoute({
      getParentRoute: () => authenticatedRoute,
      id: "_dashboard",
      component: Outlet,
    });
    const exploreRoute = createRoute({
      getParentRoute: () => dashboardRoute,
      id: "_explore",
      validateSearch: exploreSearchSchema,
      search: {
        middlewares: [
          stripSearchParams(exploreDefaults),
          retainSearchParams(["service", "environment"]),
        ],
      },
      component: Outlet,
    });

    const logsRoute = createRoute({
      getParentRoute: () => exploreRoute,
      path: "logs",
      component: () => (
        <div>
          <div>Logs page</div>
          <Link to="/errors" data-testid="to-errors">
            Go to errors
          </Link>
        </div>
      ),
    });

    function ErrorsPage() {
      const search = useSearch({
        from: "/_authenticated/_dashboard/_explore",
      });
      return (
        <div>
          <div>Errors page</div>
          <div data-testid="errors-explore-search">
            {JSON.stringify(search)}
          </div>
        </div>
      );
    }

    const errorsRoute = createRoute({
      getParentRoute: () => exploreRoute,
      path: "errors",
      component: ErrorsPage,
    });

    const routeTree = rootRoute.addChildren([
      authenticatedRoute.addChildren([
        dashboardRoute.addChildren([
          exploreRoute.addChildren([logsRoute, errorsRoute]),
        ]),
      ]),
    ]);

    const history = createMemoryHistory({ initialEntries: [INITIAL_URL] });
    const router = createRouter({ routeTree, history });

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );

    return { router, history };
  }

  it("retains service and environment search params when navigating between sibling routes", async () => {
    const { router, history } = buildExploreRouter();

    // Wait for the logs page to mount and confirm the params were parsed
    expect(await screen.findByText("Logs page")).toBeInTheDocument();
    await waitFor(() => {
      expect(router.state.resolvedLocation.search).toMatchObject({
        service: ["api"],
        environment: ["prod"],
      });
    });

    // retainSearchParams causes the Link's href to include the current explore
    // params. Assert this: removing the middleware would produce /errors with no
    // query string.
    const link = await screen.findByTestId("to-errors");
    const href = link.getAttribute("href") ?? "";
    expect(href).toMatch(/service/);
    expect(href).toMatch(/environment/);

    // Simulate what a browser does when following the Link: push the full href
    // (including the retained params) onto the history. This is how retainSearchParams
    // causes persistence in production — the params travel via the URL.
    history.push(href);

    expect(await screen.findByText("Errors page")).toBeInTheDocument();

    // The explore-level search must still carry both filters on the destination
    await waitFor(() => {
      expect(router.state.resolvedLocation.search).toMatchObject({
        service: ["api"],
        environment: ["prod"],
      });
    });
  });
});
