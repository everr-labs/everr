import type {
  TraceDetailProps,
  TracesSearchProps,
} from "@everr/telemetry-explorer/traces";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import {
  TraceDetailPage,
  TraceDetailSearchSchema,
  TracesListSearchSchema,
  TracesPage,
} from "./traces-page";

const local = vi.hoisted(() => ({
  client: {},
  repositoryClient: undefined as unknown,
}));

vi.mock("../local-telemetry/collector-status", () => ({
  LocalTelemetryGate: ({ children }: { children: ReactNode }) => children,
}));

vi.mock("../logs/local-sql-client", () => ({ localSqlClient: local.client }));

vi.mock("@everr/telemetry-explorer/traces", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@everr/telemetry-explorer/traces")>();
  return {
    ...actual,
    TracesRepository: class {
      constructor(client: unknown) {
        local.repositoryClient = client;
      }
    },
    TracesSearch: (props: TracesSearchProps) => (
      <div>
        Trace list page
        {props.renderTraceLink?.({
          traceId: "trace-1",
          start: "2026-10-06 12:00:00.000",
          end: "2026-10-06 12:00:01.000",
          className: "",
          children: "Open trace",
        })}
      </div>
    ),
    TraceExplorer: (props: TraceDetailProps) => (
      <div>
        Trace detail page
        <span>Selected {props.search.span ?? "none"}</span>
        <button type="button" onClick={props.onBack}>
          Back to traces
        </button>
        <button type="button" onClick={() => props.onSpanChange("child")}>
          Select child
        </button>
      </div>
    ),
  };
});

describe("local traces routes", () => {
  function renderTracesRoute(initialEntries: string[]) {
    const rootRoute = createRootRoute({ component: Outlet });
    const shellRoute = createRoute({
      getParentRoute: () => rootRoute,
      id: "_shell",
      component: Outlet,
    });
    const tracesRoute = createRoute({
      getParentRoute: () => shellRoute,
      path: "/traces",
      validateSearch: TracesListSearchSchema,
      component: TracesPage,
    });
    const traceDetailRoute = createRoute({
      getParentRoute: () => shellRoute,
      path: "/traces/$traceId",
      validateSearch: TraceDetailSearchSchema,
      component: TraceDetailPage,
    });
    const routeTree = rootRoute.addChildren([
      shellRoute.addChildren([tracesRoute, traceDetailRoute]),
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

  it("opens direct trace links as a full page using the local repository", async () => {
    renderTracesRoute(["/traces/trace-1?span=child"]);
    expect(await screen.findByText("Trace detail page")).toBeInTheDocument();
    expect(screen.getByText("Selected child")).toBeInTheDocument();
    expect(screen.queryByText("Trace list page")).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(local.repositoryClient).toBe(local.client);
  });

  it("preserves the detail time window and span selection when opened from the list", async () => {
    const router = renderTracesRoute(["/traces"]);
    fireEvent.click(await screen.findByRole("link", { name: "Open trace" }));
    expect(await screen.findByText("Trace detail page")).toBeInTheDocument();
    expect(screen.getByText("Selected none")).toBeInTheDocument();
    expect(router.state.location.search).toMatchObject({
      start: "2026-10-06 12:00:00.000",
      end: "2026-10-06 12:00:01.000",
    });
    fireEvent.click(screen.getByRole("button", { name: "Select child" }));
    expect(await screen.findByText("Selected child")).toBeInTheDocument();
    expect(router.state.location.search.span).toBe("child");
    fireEvent.click(screen.getByRole("button", { name: "Back to traces" }));
    expect(await screen.findByText("Trace list page")).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/traces");
  });
});
