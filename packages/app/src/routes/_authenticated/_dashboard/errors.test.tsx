import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Route as ErrorsFileRoute } from "./errors";

describe("/errors route", () => {
  it("renders the detail child route for an error fingerprint", async () => {
    const rootRoute = createRootRoute({
      component: Outlet,
    });
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
    const errorsRoute = createRoute({
      getParentRoute: () => dashboardRoute,
      path: "errors",
      component: ErrorsFileRoute.options.component,
    });
    const errorDetailRoute = createRoute({
      getParentRoute: () => errorsRoute,
      path: "$fingerprint",
      component: () => <div>Error detail child route</div>,
    });
    const routeTree = rootRoute.addChildren([
      authenticatedRoute.addChildren([
        dashboardRoute.addChildren([
          errorsRoute.addChildren([errorDetailRoute]),
        ]),
      ]),
    ]);
    const router = createRouter({
      routeTree,
      history: createMemoryHistory({ initialEntries: ["/errors/fp-1"] }),
    });

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );

    expect(
      await screen.findByText("Error detail child route"),
    ).toBeInTheDocument();
  });
});
