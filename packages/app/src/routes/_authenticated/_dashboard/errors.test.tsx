import {
  ErrorIssueSearchSchema,
  type ErrorIssuesProps,
} from "@everr/telemetry-explorer/errors";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouteMask,
  createRouter,
  Outlet,
  RouterProvider,
  stripSearchParams,
} from "@tanstack/react-router";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Route as ErrorsFileRoute } from "./errors";

vi.mock("@/data/errors/remote-repo", () => ({
  remoteErrorsRepo: {},
}));

vi.mock("@/hooks/use-realtime-subscription", () => ({
  useRealtimeSubscription: vi.fn(),
}));

vi.mock("@everr/telemetry-explorer/errors", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@everr/telemetry-explorer/errors")>();
  return {
    ...actual,
    ErrorIssues: ({
      renderIssueLink,
      search,
    }: Pick<ErrorIssuesProps, "renderIssueLink" | "search">) => (
      <div>
        <div>Error list page</div>
        <div data-testid="errors-search">{JSON.stringify(search)}</div>
        {renderIssueLink({
          fingerprint: "fp-1",
          children: "Open error fp-1",
        })}
      </div>
    ),
  };
});

describe("/errors route", () => {
  function renderErrorsRoute(
    initialEntries: string[],
    initialState?: Record<string, unknown>,
  ) {
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
      validateSearch: ErrorsFileRoute.options.validateSearch,
      search: {
        middlewares: [stripSearchParams(ErrorIssueSearchSchema.parse({}))],
      },
      component: ErrorsFileRoute.options.component,
    });
    const errorFullPageRoute = createRoute({
      getParentRoute: () => dashboardRoute,
      path: "errors/$fingerprint",
      component: () => <div>Error full page route</div>,
    });
    const errorModalRoute = createRoute({
      getParentRoute: () => errorsRoute,
      path: "$fingerprint/modal",
      component: () => <div>Error modal child route</div>,
    });
    const routeTree = rootRoute.addChildren([
      authenticatedRoute.addChildren([
        dashboardRoute.addChildren([
          errorFullPageRoute,
          errorsRoute.addChildren([errorModalRoute]),
        ]),
      ]),
    ]);
    const history = createMemoryHistory({ initialEntries });
    if (initialState) history.replace(initialEntries[0] ?? "/", initialState);

    const router = createRouter({
      routeTree,
      routeMasks: [
        createRouteMask({
          routeTree,
          from: "/errors/$fingerprint/modal",
          to: "/errors/$fingerprint",
          params: (params) => ({ fingerprint: params.fingerprint as string }),
          search: true,
          unmaskOnReload: true,
        }),
      ],
      history,
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

  it("renders the detail child route as a page for a direct error URL", async () => {
    renderErrorsRoute(["/errors/fp-1"]);

    expect(
      await screen.findByText("Error full page route"),
    ).toBeInTheDocument();
    expect(screen.queryByText("Error list page")).not.toBeInTheDocument();
  });

  it("renders a direct error URL with absolute time search params", async () => {
    renderErrorsRoute([
      "/errors/fp-1?from=2026-06-04%2018%3A45%3A10.869&to=2026-06-04%2018%3A55%3A10.869",
    ]);

    expect(
      await screen.findByText("Error full page route"),
    ).toBeInTheDocument();
    expect(screen.queryByText("Error list page")).not.toBeInTheDocument();
  });

  it("renders the detail child route in a modal when opened from the list", async () => {
    const user = userEvent.setup();
    const router = renderErrorsRoute(["/errors"]);

    await user.click(
      await screen.findByRole("link", { name: "Open error fp-1" }),
    );

    expect(screen.getByText("Error list page")).toBeInTheDocument();
    expect(screen.getByText("Error modal child route")).toBeInTheDocument();
    expect(router.state.location.href).toContain("/modal");
    expect(router.state.location.maskedLocation?.href).not.toContain("/modal");
    expect(router.state.location.maskedLocation?.href).toContain(
      "/errors/fp-1",
    );
  });

  it("renders the detail child route as a page when the masked URL is reloaded", async () => {
    renderErrorsRoute(["/errors/fp-1"]);

    expect(
      await screen.findByText("Error full page route"),
    ).toBeInTheDocument();
    expect(screen.queryByText("Error list page")).not.toBeInTheDocument();
  });

  it("renders the list page after dropping invalid empty query params", async () => {
    const router = renderErrorsRoute([
      "/errors?q=&service=&fingerprint=&occurrence=&sort=lastSeen&attributes=&from=now-30d",
    ]);

    expect(await screen.findByText("Error list page")).toBeInTheDocument();
    expect(router.state.location.href).toBe("/errors?from=now-30d");
    expect(screen.getByTestId("errors-search")).toHaveTextContent(
      JSON.stringify({
        q: "",
        service: [],
        fingerprint: "",
        sort: "lastSeen",
        attributes: [],
      }),
    );
  });
});
