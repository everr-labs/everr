import { ErrorIssueSearchSchema, type ErrorIssuesProps } from "@everr/telemetry-explorer/errors";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouteMask,
  createRouter,
  Outlet,
  RouterProvider,
  retainSearchParams,
  stripSearchParams,
} from "@tanstack/react-router";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { z } from "zod";
import { ErrorDetailRouteContent } from "./-error-detail";
import { Route as ErrorsFileRoute } from "./errors";

vi.mock("@/data/errors/remote-repo", () => ({
  remoteErrorsRepo: {},
}));

vi.mock("@/data/runs/options", () => ({
  runSpansOptions: vi.fn(() => ({
    queryKey: ["runs", "spans", "test"],
    queryFn: vi.fn(),
  })),
}));

const realtimeSubscriptions = vi.hoisted(() => ({
  starts: [] as Array<{ scope: "tenant" } | { scope: "trace"; traceId: string }>,
  stops: [] as Array<{ scope: "tenant" } | { scope: "trace"; traceId: string }>,
}));

vi.mock("@/hooks/use-realtime-subscription", async () => {
  const { useEffect } = await import("react");

  return {
    useRealtimeSubscription: vi.fn(
      (opts: { scope: "tenant" } | { scope: "trace"; traceId: string }) => {
        const traceId = opts.scope === "trace" ? opts.traceId : undefined;

        useEffect(() => {
          const subscription =
            traceId !== undefined
              ? ({ scope: "trace", traceId } as const)
              : ({ scope: "tenant" } as const);
          realtimeSubscriptions.starts.push(subscription);

          return () => {
            realtimeSubscriptions.stops.push(subscription);
          };
        }, [traceId]);
      },
    ),
  };
});

vi.mock("@everr/telemetry-explorer/errors", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@everr/telemetry-explorer/errors")>();
  return {
    ...actual,
    ErrorDetail: ({ fingerprint }: { fingerprint: string }) => (
      <div>Error detail page {fingerprint}</div>
    ),
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
  beforeEach(() => {
    realtimeSubscriptions.starts = [];
    realtimeSubscriptions.stops = [];
  });

  function renderErrorsRoute(initialEntries: string[], initialState?: Record<string, unknown>) {
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
    const exploreSearchSchema = z.object({
      service: z.array(z.string()).catch([]).default([]),
      environment: z.array(z.string()).catch([]).default([]),
    });
    const exploreDefaults = exploreSearchSchema.parse({});
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
    const errorsRoute = createRoute({
      getParentRoute: () => exploreRoute,
      path: "errors",
      validateSearch: ErrorsFileRoute.options.validateSearch,
      search: {
        middlewares: [stripSearchParams(ErrorIssueSearchSchema.parse({}))],
      },
      component: ErrorsFileRoute.options.component,
    });
    const errorFullPageRoute = createRoute({
      getParentRoute: () => exploreRoute,
      path: "errors/$fingerprint",
      component: () => <div>Error full page route</div>,
    });
    const errorModalRoute = createRoute({
      getParentRoute: () => errorsRoute,
      path: "$fingerprint/modal",
      component: ErrorModalChildRoute,
    });
    function ErrorModalChildRoute() {
      const { fingerprint } = errorModalRoute.useParams();
      const search = errorModalRoute.useSearch();

      return (
        <ErrorDetailRouteContent
          fingerprint={fingerprint}
          search={search}
          detailTo="/errors/$fingerprint/modal"
          onClose={() => undefined}
        />
      );
    }
    const routeTree = rootRoute.addChildren([
      authenticatedRoute.addChildren([
        dashboardRoute.addChildren([
          exploreRoute.addChildren([
            errorFullPageRoute,
            errorsRoute.addChildren([errorModalRoute]),
          ]),
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

    expect(await screen.findByText("Error full page route")).toBeInTheDocument();
    expect(screen.queryByText("Error list page")).not.toBeInTheDocument();
  });

  it("renders a direct error URL with absolute time search params", async () => {
    renderErrorsRoute([
      "/errors/fp-1?from=2026-06-04%2018%3A45%3A10.869&to=2026-06-04%2018%3A55%3A10.869",
    ]);

    expect(await screen.findByText("Error full page route")).toBeInTheDocument();
    expect(screen.queryByText("Error list page")).not.toBeInTheDocument();
  });

  it("renders the detail child route in a modal when opened from the list", async () => {
    const user = userEvent.setup();
    const router = renderErrorsRoute(["/errors"]);

    await user.click(await screen.findByRole("link", { name: "Open error fp-1" }));

    expect(screen.getByText("Error list page")).toBeInTheDocument();
    expect(screen.getByText("Error detail page fp-1")).toBeInTheDocument();
    expect(router.state.location.href).toContain("/modal");
    expect(router.state.location.maskedLocation?.href).not.toContain("/modal");
    expect(router.state.location.maskedLocation?.href).toContain("/errors/fp-1");
  });

  it("does not start another tenant realtime subscription for modal details", async () => {
    const user = userEvent.setup();
    renderErrorsRoute(["/errors"]);

    await waitFor(() => expect(realtimeSubscriptions.starts).toEqual([{ scope: "tenant" }]));

    await user.click(await screen.findByRole("link", { name: "Open error fp-1" }));

    expect(screen.getByText("Error list page")).toBeInTheDocument();
    expect(screen.getByText("Error detail page fp-1")).toBeInTheDocument();
    await waitFor(() => expect(realtimeSubscriptions.starts).toEqual([{ scope: "tenant" }]));
  });

  it("renders the detail child route as a page when the masked URL is reloaded", async () => {
    renderErrorsRoute(["/errors/fp-1"]);

    expect(await screen.findByText("Error full page route")).toBeInTheDocument();
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
