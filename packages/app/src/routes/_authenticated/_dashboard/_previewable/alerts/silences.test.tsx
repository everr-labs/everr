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
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AlertingSilence } from "@/data/alerting/types";
import { Route as AlertsSilencesFileRoute } from "./silences";

const mocks = vi.hoisted(() => ({
  listAlertingSilences: vi.fn(),
  createAlertingSilence: vi.fn(),
  expireAlertingSilence: vi.fn(),
  listAlertingRules: vi.fn(),
}));

vi.mock("@/data/alerting/silences/server", () => ({
  listAlertingSilences: mocks.listAlertingSilences,
  createAlertingSilence: mocks.createAlertingSilence,
  expireAlertingSilence: mocks.expireAlertingSilence,
}));
vi.mock("@/data/alerting/silences/suggestions", () => ({
  listAlertingLabelKeys: vi.fn().mockResolvedValue([]),
  listAlertingLabelValues: vi.fn().mockResolvedValue([]),
}));
vi.mock("@/data/alerting/rules/server", () => ({
  listAlertingRules: mocks.listAlertingRules,
}));

function alertingSilence(
  overrides: Partial<AlertingSilence> = {},
): AlertingSilence {
  return {
    id: "sil-1",
    tenant: "org1",
    matchers: [{ label: "svc", op: "eq", value: "api" }],
    starts_at: new Date(Date.now() - 3_600_000).toISOString(),
    ends_at: new Date(Date.now() + 3_600_000).toISOString(),
    comment: "maintenance",
    author: null,
    created_at: new Date(Date.now() - 3_600_000).toISOString(),
    ...overrides,
  };
}

function renderSilencesPage() {
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
  const silencesRoute = createRoute({
    getParentRoute: () => alertsLayoutRoute,
    path: "silences",
    component: AlertsSilencesFileRoute.options.component,
  });
  const routeTree = rootRoute.addChildren([
    authenticatedRoute.addChildren([
      dashboardRoute.addChildren([
        alertsLayoutRoute.addChildren([silencesRoute]),
      ]),
    ]),
  ]);

  const history = createMemoryHistory({ initialEntries: ["/alerts/silences"] });
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const router = createRouter({ routeTree, history, context: { queryClient } });

  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mocks.listAlertingSilences.mockReset();
  mocks.createAlertingSilence.mockReset();
  mocks.expireAlertingSilence.mockReset();
  // The rules list only serves matcher label resolution; nothing here
  // exercises it, so it stays at its empty default across tests.
  mocks.listAlertingRules.mockResolvedValue([]);
});

describe("/alerts/silences", () => {
  it("lists an active silence", async () => {
    mocks.listAlertingSilences.mockResolvedValue([alertingSilence()]);

    renderSilencesPage();

    expect(await screen.findByText("maintenance")).toBeInTheDocument();
  });

  it("opens the create drawer from New silence", async () => {
    const user = userEvent.setup();
    mocks.listAlertingSilences.mockResolvedValue([]);

    renderSilencesPage();

    await user.click(
      await screen.findByRole("button", { name: /new silence/i }),
    );
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });
});
