import { TraceSearchParamsSchema } from "@everr/telemetry-explorer/traces";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
  useNavigate,
} from "@tanstack/react-router";
import { render, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { z } from "zod";
import { query } from "@/lib/clickhouse";
import { Route as TracesFileRoute } from "./traces";

vi.mock("@/components/explore-persistent-filters", () => ({
  ExplorePersistentFilters: () => null,
}));

afterEach(() => {
  vi.clearAllMocks();
});

it("leaves recording roots out of the trace list query", async () => {
  vi.mocked(query).mockResolvedValue([]);
  vi.spyOn(TracesFileRoute, "useSearch").mockReturnValue(
    TraceSearchParamsSchema.parse({}),
  );
  vi.spyOn(TracesFileRoute, "useNavigate").mockImplementation(() =>
    useNavigate(),
  );
  const rootRoute = createRootRoute({ component: Outlet });
  const exploreRoute = createRoute({
    getParentRoute: () => rootRoute,
    id: "/_authenticated/_organization/_dashboard/_appAccess/_provisioned/_explore",
    validateSearch: z.object({
      service: z.array(z.string()).optional(),
      environment: z.array(z.string()).optional(),
    }),
    component: Outlet,
  });
  const tracesRoute = createRoute({
    getParentRoute: () => exploreRoute,
    path: "traces",
    component: TracesFileRoute.options.component,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([exploreRoute.addChildren([tracesRoute])]),
    history: createMemoryHistory({ initialEntries: ["/traces"] }),
  });
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );

  await waitFor(() => {
    const searches = vi
      .mocked(query)
      .mock.calls.map((call) => String(call[0]))
      .filter((sql) => sql.includes("WITH page AS"));
    expect(searches.length).toBeGreaterThan(0);
    const page = searches[0]
      ?.split("WITH page AS (")[1]
      ?.split("), aggregated AS (")[0];
    expect(page).toContain("TraceId NOT IN");
    expect(page).toContain("ParentSpanId = ''");
    expect(page).toContain("SpanName = 'recording'");
    expect(page).not.toContain("tenant_id");
  });
});
