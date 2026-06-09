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
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import {
  TraceDetailPage,
  TraceDetailParamsSchema,
  TraceSearchParamsSchema,
  TracesPage,
} from "./traces-page";

vi.mock("../local-telemetry/collector-status", () => ({
  LocalTelemetryGate: ({ children }: { children: ReactNode }) => children,
}));

vi.mock("@/features/logs/local-sql-client", () => ({
  localSqlClient: {},
}));

vi.mock("@everr/ui/components/dialog", () => ({
  Dialog: ({ children }: { children: ReactNode }) => (
    <section role="dialog">{children}</section>
  ),
  DialogContent: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  DialogDescription: ({ children }: { children: ReactNode }) => (
    <p>{children}</p>
  ),
  DialogHeader: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  DialogTitle: ({ children }: { children: ReactNode }) => <h1>{children}</h1>,
}));

vi.mock("@everr/telemetry-explorer/traces", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@everr/telemetry-explorer/traces")>();

  return {
    ...actual,
    TracesRepository: class TracesRepository {},
    TracesSearch: () => <div>Trace list page</div>,
    TraceDetail: () => <div>Trace detail page</div>,
  };
});

describe("desktop traces routes", () => {
  function renderTracesRoute(initialEntries: string[]) {
    const rootRoute = createRootRoute({ component: Outlet });
    const authenticatedRoute = createRoute({
      getParentRoute: () => rootRoute,
      id: "authenticated",
      component: Outlet,
    });
    const tracesRoute = createRoute({
      getParentRoute: () => authenticatedRoute,
      path: "/traces",
      validateSearch: TraceSearchParamsSchema,
      component: TracesPage,
    });
    const traceDetailRoute = createRoute({
      getParentRoute: () => tracesRoute,
      path: "$traceId",
      validateSearch: TraceDetailParamsSchema,
      component: TraceDetailPage,
    });
    const routeTree = rootRoute.addChildren([
      authenticatedRoute.addChildren([
        tracesRoute.addChildren([traceDetailRoute]),
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
  }

  it("renders direct trace detail routes through the dialog route", async () => {
    renderTracesRoute(["/traces/trace-1"]);

    expect(await screen.findByText("Trace list page")).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Trace detail page")).toBeInTheDocument();
  });
});
