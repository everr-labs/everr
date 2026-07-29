import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Route as AlertsIndexFileRoute } from "./index";

const mocks = vi.hoisted(() => ({
  listCcAlerts: vi.fn(),
  listCcRules: vi.fn(),
  listCcSlos: vi.fn(),
  getCcSloStatus: vi.fn(),
  listCcRoutes: vi.fn(),
  listCcReceivers: vi.fn(),
  listCcSilences: vi.fn(),
  listCcSubscriptions: vi.fn(),
  listCcEventHistory: vi.fn(),
}));

vi.mock("@/data/cc/server", () => ({
  listCcAlerts: mocks.listCcAlerts,
  listCcRules: mocks.listCcRules,
  listCcSlos: mocks.listCcSlos,
  getCcSloStatus: mocks.getCcSloStatus,
  listCcRoutes: mocks.listCcRoutes,
  listCcReceivers: mocks.listCcReceivers,
  listCcSilences: mocks.listCcSilences,
  listCcSubscriptions: mocks.listCcSubscriptions,
  listCcEventHistory: mocks.listCcEventHistory,
}));

function renderOverviewRoute() {
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
  const alertsLayoutRoute = createRoute({
    getParentRoute: () => dashboardRoute,
    path: "alerts",
    component: Outlet,
  });
  const overviewRoute = createRoute({
    getParentRoute: () => alertsLayoutRoute,
    path: "/",
    component: AlertsIndexFileRoute.options.component,
  });

  const routeTree = rootRoute.addChildren([
    authenticatedRoute.addChildren([
      dashboardRoute.addChildren([
        alertsLayoutRoute.addChildren([overviewRoute]),
      ]),
    ]),
  ]);

  const history = createMemoryHistory({ initialEntries: ["/alerts/"] });
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const router = createRouter({ routeTree, history, context: { queryClient } });

  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { router, queryClient };
}

async function cardOf(headingText: string): Promise<HTMLElement> {
  const heading = await screen.findByRole("heading", { name: headingText });
  const card = heading.closest('[data-slot="card"]');
  if (card === null) throw new Error(`no card ancestor for "${headingText}"`);
  return card as HTMLElement;
}

beforeEach(() => {
  for (const fn of Object.values(mocks)) fn.mockReset();
  mocks.listCcAlerts.mockResolvedValue([]);
  mocks.listCcRules.mockResolvedValue([]);
  mocks.listCcSlos.mockResolvedValue([]);
  mocks.getCcSloStatus.mockResolvedValue(null);
  mocks.listCcRoutes.mockResolvedValue([]);
  mocks.listCcReceivers.mockResolvedValue([]);
  mocks.listCcSilences.mockResolvedValue([]);
  mocks.listCcSubscriptions.mockResolvedValue([]);
  mocks.listCcEventHistory.mockResolvedValue([]);
});

describe("/alerts overview", () => {
  it("shows an error (not a false 'no events') when the history query fails", async () => {
    mocks.listCcEventHistory.mockRejectedValue(new Error("clickhouse down"));

    renderOverviewRoute();

    const recent = await cardOf("Recent events");
    expect(
      await within(recent).findByText(/Event history unavailable/),
    ).toBeInTheDocument();
    expect(
      within(recent).queryByText(/No stored events/),
    ).not.toBeInTheDocument();
  });
});
