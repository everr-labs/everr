import type * as TelemetryTraces from "@everr/telemetry-explorer/traces";
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
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vite-plus/test";
import { z } from "zod";
import { Route as TracesFileRoute } from "./traces";

vi.mock("#app/data/traces/remote-repo.ts", () => ({
  remoteTracesRepo: {},
}));

vi.mock("@everr/telemetry-explorer/traces", async (importOriginal) => {
  const actual = await importOriginal<typeof TelemetryTraces>();
  return {
    ...actual,
    TracesSearch: ({
      renderTraceLink,
    }: {
      renderTraceLink: (props: {
        traceId: string;
        className: string;
        children: ReactNode;
      }) => ReactNode;
    }) => (
      <div>
        <div>Trace list page</div>
        {renderTraceLink({
          traceId: "trace-1",
          className: "trace-link",
          children: "Open trace trace-1",
        })}
      </div>
    ),
  };
});

describe("/traces route", () => {
  function renderTracesRoute(initialEntries: string[], initialState?: Record<string, unknown>) {
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
    const tracesRoute = createRoute({
      getParentRoute: () => exploreRoute,
      path: "traces",
      component: TracesFileRoute.options.component,
    });
    const traceFullPageRoute = createRoute({
      getParentRoute: () => exploreRoute,
      path: "traces/$traceId",
      component: () => <div>Trace full page route</div>,
    });
    const routeTree = rootRoute.addChildren([
      authenticatedRoute.addChildren([
        dashboardRoute.addChildren([exploreRoute.addChildren([traceFullPageRoute, tracesRoute])]),
      ]),
    ]);
    const history = createMemoryHistory({ initialEntries });
    if (initialState) history.replace(initialEntries[0] ?? "/", initialState);

    const router = createRouter({
      routeTree,
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

  it("renders the detail child route as a page for a direct trace URL", async () => {
    renderTracesRoute(["/traces/trace-1"]);

    expect(await screen.findByText("Trace full page route")).toBeInTheDocument();
    expect(screen.queryByText("Trace list page")).not.toBeInTheDocument();
  });

  it("opens a full-page trace and preserves list filters without adding trace timestamps", async () => {
    const user = userEvent.setup();
    const router = renderTracesRoute(["/traces?from=now-1h&to=now"]);
    await user.click(await screen.findByRole("link", { name: "Open trace trace-1" }));
    expect(await screen.findByText("Trace full page route")).toBeInTheDocument();
    expect(screen.queryByText("Trace list page")).not.toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/traces/trace-1");
    expect(router.state.location.search).toMatchObject({
      from: "now-1h",
      to: "now",
    });
    expect(router.state.location.search).not.toHaveProperty("start");
    expect(router.state.location.search).not.toHaveProperty("end");
    expect(router.state.location.maskedLocation).toBeUndefined();
  });

  it("renders the detail child route as a page when the URL is reloaded", async () => {
    renderTracesRoute(["/traces/trace-1"]);

    expect(await screen.findByText("Trace full page route")).toBeInTheDocument();
    expect(screen.queryByText("Trace list page")).not.toBeInTheDocument();
  });
});
