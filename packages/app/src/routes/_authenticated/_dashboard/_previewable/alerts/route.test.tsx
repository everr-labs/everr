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
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { alertingRuleViewFixture } from "@/data/alerting/test-fixtures";
// The layout route lives at `../alerts.tsx`, the pathless-sibling file next to
// this `alerts/` directory: adding a second `alerts/route.tsx` would define the
// same route id twice and break route generation. This file still tests the
// section layout, just from where it actually lives.
import { Route as AlertsSectionFileRoute } from "../alerts";
import { Route as AlertsIndexFileRoute } from "./index";
import { Route as AlertsRulesFileRoute } from "./rules";
import { Route as AlertsRuleDetailFileRoute } from "./rules_.$project.$slug";

const mocks = vi.hoisted(() => ({
  listAlertingAlerts: vi.fn(),
  listAlertingRules: vi.fn(),
  getAlertingRuleByName: vi.fn(),
  pauseAlertingRule: vi.fn(),
  resumeAlertingRule: vi.fn(),
  listAlertingRoutes: vi.fn(),
  listAlertingReceivers: vi.fn(),
  listAlertingSilences: vi.fn(),
  listAlertingEventHistory: vi.fn(),
}));

vi.mock("@/data/alerting/instances/server", () => ({
  listAlertingAlerts: mocks.listAlertingAlerts,
}));
vi.mock("@/data/alerting/rules/server", () => ({
  listAlertingRules: mocks.listAlertingRules,
  getAlertingRuleByName: mocks.getAlertingRuleByName,
  pauseAlertingRule: mocks.pauseAlertingRule,
  resumeAlertingRule: mocks.resumeAlertingRule,
}));
vi.mock("@/data/alerting/delivery/server", () => ({
  listAlertingRoutes: mocks.listAlertingRoutes,
  listAlertingReceivers: mocks.listAlertingReceivers,
}));
vi.mock("@/data/alerting/silences/server", () => ({
  listAlertingSilences: mocks.listAlertingSilences,
  createAlertingSilence: vi.fn(),
  expireAlertingSilence: vi.fn(),
}));
vi.mock("@/data/alerting/history/server", () => ({
  listAlertingEventHistory: mocks.listAlertingEventHistory,
}));
vi.mock("@/data/alerting/routing/suggestions", () => ({
  listAlertingLabelKeys: vi.fn().mockResolvedValue([]),
  listAlertingLabelValues: vi.fn().mockResolvedValue([]),
}));

/** `useMediaQuery` reads `window.matchMedia`, which jsdom implements but never
 *  evaluates against a real viewport: it always reports the wide layout. Only
 *  a narrow-window test needs this stub. */
function matchMediaMock(matches: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockReturnValue({
      matches,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }),
  );
}

function renderAlertsLayout(options: { initialEntry?: string } = {}) {
  const { initialEntry = "/alerts" } = options;
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
    component: AlertsSectionFileRoute.options.component,
  });
  const indexRoute = createRoute({
    getParentRoute: () => alertsLayoutRoute,
    path: "/",
    component: AlertsIndexFileRoute.options.component,
  });
  const rulesRoute = createRoute({
    getParentRoute: () => alertsLayoutRoute,
    path: "rules",
    component: AlertsRulesFileRoute.options.component,
  });
  const ruleDetailRoute = createRoute({
    getParentRoute: () => alertsLayoutRoute,
    path: "rules/$project/$slug",
    component: AlertsRuleDetailFileRoute.options.component,
  });
  const routeTree = rootRoute.addChildren([
    authenticatedRoute.addChildren([
      dashboardRoute.addChildren([
        alertsLayoutRoute.addChildren([
          indexRoute,
          rulesRoute,
          ruleDetailRoute,
        ]),
      ]),
    ]),
  ]);

  const history = createMemoryHistory({ initialEntries: [initialEntry] });
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

beforeEach(() => {
  for (const fn of Object.values(mocks)) fn.mockReset();
  mocks.listAlertingAlerts.mockResolvedValue([]);
  mocks.listAlertingRules.mockResolvedValue([]);
  mocks.listAlertingRoutes.mockResolvedValue([]);
  mocks.listAlertingReceivers.mockResolvedValue([]);
  mocks.listAlertingSilences.mockResolvedValue([]);
  mocks.listAlertingEventHistory.mockResolvedValue([]);
  mocks.getAlertingRuleByName.mockResolvedValue(alertingRuleViewFixture());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("alerts section nav", () => {
  it("marks exactly one destination active, and Triage is not active on All Rules", async () => {
    renderAlertsLayout({ initialEntry: "/alerts/rules" });

    const nav = await screen.findByRole("navigation", { name: "Alerting" });
    const active = within(nav)
      .getAllByRole("link")
      .filter((el) => el.getAttribute("data-active") === "true");
    expect(active).toHaveLength(1);
    expect(active[0]).toHaveTextContent("All Rules");
  });

  it("keeps All Rules active on a rule detail URL", async () => {
    renderAlertsLayout({ initialEntry: "/alerts/rules/demo/flapping" });

    const nav = await screen.findByRole("navigation", { name: "Alerting" });
    const active = within(nav)
      .getAllByRole("link")
      .filter((el) => el.getAttribute("data-active") === "true");
    expect(active).toHaveLength(1);
    expect(active[0]).toHaveTextContent("All Rules");
  });

  it("puts the nav behind a button on a narrow window", async () => {
    matchMediaMock(true); // NARROW_QUERY matches
    renderAlertsLayout({ initialEntry: "/alerts" });

    expect(
      await screen.findByRole("button", { name: "Alerting" }),
    ).toBeInTheDocument();
    // Exactly one instance of the nav exists at a time: on a narrow window it
    // lives inside the closed sheet, not rendered a second time beside the
    // button.
    expect(
      screen.queryByRole("navigation", { name: "Alerting" }),
    ).not.toBeInTheDocument();
  });
});
