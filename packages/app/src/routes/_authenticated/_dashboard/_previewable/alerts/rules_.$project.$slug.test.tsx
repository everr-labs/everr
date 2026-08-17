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
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { alertingRuleViewFixture as alertingRule } from "@/data/alerting/test-fixtures";
import { TimeRangeSearchSchema } from "@/lib/time-range";
import { Route as RuleDetailFileRoute } from "./rules_.$project.$slug";

const mocks = vi.hoisted(() => ({
  getAlertingRuleByName: vi.fn(),
  getAlertingRuleEvaluationSeries: vi.fn(),
  pauseAlertingRule: vi.fn(),
  resumeAlertingRule: vi.fn(),
  listAlertingAlerts: vi.fn(),
  listAlertingEventHistory: vi.fn(),
  listAlertingSilences: vi.fn(),
  createAlertingSilence: vi.fn(),
  expireAlertingSilence: vi.fn(),
  listAlertingLabelKeys: vi.fn(),
  listAlertingLabelValues: vi.fn(),
}));

vi.mock("@/data/alerting/rules/server", () => ({
  getAlertingRuleByName: mocks.getAlertingRuleByName,
  getAlertingRuleEvaluationSeries: mocks.getAlertingRuleEvaluationSeries,
  pauseAlertingRule: mocks.pauseAlertingRule,
  resumeAlertingRule: mocks.resumeAlertingRule,
}));
vi.mock("@/data/alerting/instances/server", () => ({
  listAlertingAlerts: mocks.listAlertingAlerts,
}));
vi.mock("@/data/alerting/history/server", () => ({
  listAlertingEventHistory: mocks.listAlertingEventHistory,
}));
// The Silence drawer renders unconditionally on this page; the real module
// pulls in the drizzle client, which throws when it runs in a browser bundle.
vi.mock("@/data/alerting/silences/server", () => ({
  listAlertingSilences: mocks.listAlertingSilences,
  createAlertingSilence: mocks.createAlertingSilence,
  expireAlertingSilence: mocks.expireAlertingSilence,
}));
// The drawer's matcher editor asks for label suggestions, whose real
// implementation reaches the drizzle client directly (no server-fn mock
// upstream of it covers that).
vi.mock("@/data/alerting/routing/suggestions", () => ({
  listAlertingLabelKeys: mocks.listAlertingLabelKeys,
  listAlertingLabelValues: mocks.listAlertingLabelValues,
}));

function renderRuleDetail(options: { initialEntry?: string } = {}) {
  const { initialEntry = "/alerts/rules/default/flapping" } = options;
  const rootRoute = createRootRoute({ component: Outlet });
  const authenticatedRoute = createRoute({
    getParentRoute: () => rootRoute,
    id: "_authenticated",
    component: Outlet,
  });
  const dashboardRoute = createRoute({
    getParentRoute: () => authenticatedRoute,
    id: "_dashboard",
    validateSearch: TimeRangeSearchSchema.extend({
      preview: z.string().optional(),
    }),
    component: Outlet,
  });
  const alertsLayoutRoute = createRoute({
    getParentRoute: () => dashboardRoute,
    path: "alerts",
    component: Outlet,
  });
  const ruleDetailRoute = createRoute({
    getParentRoute: () => alertsLayoutRoute,
    path: "rules/$project/$slug",
    component: RuleDetailFileRoute.options.component,
  });
  const routeTree = rootRoute.addChildren([
    authenticatedRoute.addChildren([
      dashboardRoute.addChildren([
        alertsLayoutRoute.addChildren([ruleDetailRoute]),
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
  mocks.listAlertingEventHistory.mockResolvedValue([]);
  mocks.getAlertingRuleEvaluationSeries.mockResolvedValue({
    points: [],
    recent_points: [],
  });
  mocks.listAlertingSilences.mockResolvedValue([]);
});

describe("/alerts/rules/$project/$slug", () => {
  it("puts the description under the name and keeps every definition fact", async () => {
    mocks.getAlertingRuleByName.mockResolvedValue(
      alertingRule({
        notification_channels: ["oncall-hook"],
        spec: {
          ...alertingRule().spec,
          interval_secs: 60,
          max_interval_secs: 300,
          for_secs: 600,
          resolve_after: 2,
          label_columns: ["host"],
          condition: { operator: "gt", threshold: 0 },
          sql: "SELECT 1",
          annotations: {
            "everr.display.name": "Flapping check",
            summary: "Flaps when the source keeps toggling.",
            "everr.display.description": "Fires when the flap condition holds.",
          },
        },
      }),
    );

    renderRuleDetail();

    await screen.findByRole("heading", { name: "Flapping check" });
    expect(
      screen.getByText("Flaps when the source keeps toggling."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Fires when the flap condition holds."),
    ).toBeInTheDocument();

    expect(screen.getByText(/every 1m/i)).toBeInTheDocument();
    expect(screen.getByText(/up to 5m/i)).toBeInTheDocument();
    expect(screen.getByText(/for 10m/i)).toBeInTheDocument();
    expect(screen.getByText(/2 missed/i)).toBeInTheDocument();
    expect(screen.getByText(/to oncall-hook/i)).toBeInTheDocument();
    expect(screen.getByText(/value > 0/)).toBeInTheDocument();
    expect(screen.getByText(/host/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /query/i })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /annotations/i }),
    ).toBeInTheDocument();
  });
});
