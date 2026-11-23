import type * as TelemetryErrors from "@everr/telemetry-explorer/errors";
import { ErrorIssueSearchSchema, type ErrorIssuesProps } from "@everr/telemetry-explorer/errors";
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
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vite-plus/test";
import { z } from "zod";
import { Route as ErrorsFileRoute } from "./errors";

vi.mock("#app/data/errors/remote-repo.ts", () => ({
  remoteErrorsRepo: {},
}));

vi.mock("@everr/telemetry-explorer/errors", async (importOriginal) => {
  const actual = await importOriginal<typeof TelemetryErrors>();
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
          className: "",
          children: "Open error fp-1",
        })}
      </div>
    ),
  };
});

describe("/errors route", () => {
  function renderErrorsRoute(initialEntries: string[]) {
    const rootRoute = createRootRoute({
      component: Outlet,
    });
    const authenticatedRoute = createRoute({
      getParentRoute: () => rootRoute,
      id: "_authenticated/_organization",
      component: Outlet,
    });
    const dashboardRoute = createRoute({
      getParentRoute: () => authenticatedRoute,
      id: "_dashboard",
      component: Outlet,
    });
    const exploreSearchSchema = z.object({
      service: z.array(z.string()).catch([]).default([]),
      environment: z.array(z.string()).catch([]).default([]),
    });
    const exploreDefaults = exploreSearchSchema.parse({});
    const exploreRoute = createRoute({
      getParentRoute: () => dashboardRoute,
      id: "_appAccess/_provisioned/_explore",
      validateSearch: exploreSearchSchema,
      search: {
        middlewares: [
          stripSearchParams(exploreDefaults),
          retainSearchParams(["service", "environment"]),
        ],
      },
      component: Outlet,
    });
    const errorsRoute = createRoute({
      getParentRoute: () => exploreRoute,
      path: "errors",
      validateSearch: ErrorsFileRoute.options.validateSearch,
      search: {
        middlewares: [stripSearchParams(ErrorIssueSearchSchema.parse({}))],
      },
      component: ErrorsFileRoute.options.component,
    });
    const errorDetailRoute = createRoute({
      getParentRoute: () => exploreRoute,
      path: "errors/$fingerprint",
      validateSearch: ErrorIssueSearchSchema,
      component: () => <div>Error detail page</div>,
    });
    const routeTree = rootRoute.addChildren([
      authenticatedRoute.addChildren([
        dashboardRoute.addChildren([exploreRoute.addChildren([errorsRoute, errorDetailRoute])]),
      ]),
    ]);
    const history = createMemoryHistory({ initialEntries });

    const router = createRouter({ routeTree, history });

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

  it("opens an error from the list as its own page, keeping the list filters", async () => {
    const user = userEvent.setup();
    const router = renderErrorsRoute(["/errors?q=timeout"]);

    await user.click(await screen.findByRole("link", { name: "Open error fp-1" }));

    expect(await screen.findByText("Error detail page")).toBeInTheDocument();
    expect(screen.queryByText("Error list page")).not.toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/errors/fp-1");
    expect(router.state.location.search).toMatchObject({ q: "timeout" });
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
