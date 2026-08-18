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
vi.mock("@/data/alerting/silences/suggestions", () => ({
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

// What `everr apply` really stores: the notification message and every link
// are generated annotations, and only `dashboard` was written by a person.
const APPLIED_ANNOTATIONS = {
  "everr.display.name": "Flapping check",
  "everr.display.description": "Fires when the flap condition holds.",
  summary: `flapping on \${host} (\${value} toggles)`,
  description: `Last seen on \${host}.`,
  "everr.label.team": "platform",
  "everr.runbook": "default/flapping",
  "link.alert": "https://app.example.com/alerts/rules/default/flapping",
  "link.runbook": "https://app.example.com/runbooks/default/flapping",
  dashboard: "https://dash.example.com/d/flapping",
};

function mockAppliedRule(
  annotations: Record<string, string> = APPLIED_ANNOTATIONS,
) {
  mocks.getAlertingRuleByName.mockResolvedValue(
    alertingRule({
      spec: {
        ...alertingRule().spec,
        notifications: { channels: ["oncall-hook"] },
        interval_secs: 60,
        max_interval_secs: 300,
        for_secs: 600,
        resolve_after: 2,
        label_columns: ["host"],
        condition: { operator: "gt", threshold: 0 },
        sql: "SELECT 1",
        annotations,
      },
    }),
  );
}

describe("/alerts/rules/$project/$slug", () => {
  it("puts the description under the name and keeps every definition fact", async () => {
    mockAppliedRule();

    renderRuleDetail();

    await screen.findByRole("heading", { name: "Flapping check" });
    expect(
      screen.getByText("Fires when the flap condition holds."),
    ).toBeInTheDocument();

    expect(screen.getByText(/^severity$/i)).toBeInTheDocument();
    expect(screen.getByText("critical")).toBeInTheDocument();
    expect(screen.getByText(/^every$/i)).toBeInTheDocument();
    expect(screen.getByText("1m")).toBeInTheDocument();
    expect(screen.getByText(/up to 5m/i)).toBeInTheDocument();
    expect(screen.getByText(/fires after/i)).toBeInTheDocument();
    expect(screen.getByText("10m")).toBeInTheDocument();
    expect(screen.getByText("2 non-breaching evaluations")).toBeInTheDocument();
    expect(screen.getByText("oncall-hook")).toBeInTheDocument();
    expect(screen.getByText(/value > 0/)).toBeInTheDocument();
    expect(screen.getByText(/grouped by host/)).toBeInTheDocument();
    // The SQL itself stays in the as-code definition, not on this page.
    expect(screen.queryByText("SELECT 1")).not.toBeInTheDocument();
  });

  it("sends a rule with no direct channel to the default destination", async () => {
    mocks.getAlertingRuleByName.mockResolvedValue(
      alertingRule({
        spec: {
          ...alertingRule().spec,
          for_secs: 0,
          annotations: APPLIED_ANNOTATIONS,
        },
      }),
    );

    renderRuleDetail();

    await screen.findByRole("heading", { name: "Flapping check" });
    expect(
      screen.getByRole("link", { name: "Default destination" }),
    ).toHaveAttribute("href", "/alerts/notifications");
    // `for: 0` is the absence of a wait, not a duration worth reading.
    expect(screen.getByText("first breach")).toBeInTheDocument();
    expect(screen.queryByText("0s")).not.toBeInTheDocument();
  });

  it("shows the rule's labels beside its name", async () => {
    mockAppliedRule();

    renderRuleDetail();

    await screen.findByRole("heading", { name: "Flapping check" });
    expect(screen.getByText("team")).toBeInTheDocument();
    expect(screen.getByText("platform")).toBeInTheDocument();
  });

  it("keeps the notification templates out of the page prose", async () => {
    mockAppliedRule();

    renderRuleDetail();

    await screen.findByRole("heading", { name: "Flapping check" });
    // The body template belongs to a notification, so it must not surface
    // until the reader opens the message it belongs to.
    expect(screen.queryByText(/Last seen on/)).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /notification message/i }),
    ).toHaveTextContent(`flapping on \${host} (\${value} toggles)`);
  });

  it("marks the placeholders in the notification message", async () => {
    const user = userEvent.setup();
    mockAppliedRule();

    renderRuleDetail();

    await screen.findByRole("heading", { name: "Flapping check" });
    await user.click(
      screen.getByRole("button", { name: /notification message/i }),
    );

    // The title and the body both reference the same column.
    expect(
      await screen.findAllByText(`\${host}`, { exact: true }),
    ).toHaveLength(2);
    expect(screen.getByText(`\${value}`, { exact: true })).toBeVisible();
    expect(screen.getByText(/Last seen on/)).toBeInTheDocument();
    expect(
      screen.getByText(/filled from the query result row/i),
    ).toBeInTheDocument();
  });

  it("lists only the annotations a person wrote", async () => {
    const user = userEvent.setup();
    mockAppliedRule();

    renderRuleDetail();

    await screen.findByRole("heading", { name: "Flapping check" });
    const trigger = screen.getByRole("button", { name: /annotations/i });
    expect(trigger).toHaveTextContent("dashboard");
    expect(trigger).not.toHaveTextContent("link.alert");

    await user.click(trigger);
    const link = await screen.findByRole("link", {
      name: "https://dash.example.com/d/flapping",
    });
    expect(link).toHaveAttribute("href", "https://dash.example.com/d/flapping");
    expect(screen.queryByText("everr.runbook")).not.toBeInTheDocument();
    expect(screen.queryByText("everr.display.name")).not.toBeInTheDocument();
  });

  it("hides the annotations disclosure when every key is generated", async () => {
    const { dashboard: _dashboard, ...generatedOnly } = APPLIED_ANNOTATIONS;
    mockAppliedRule(generatedOnly);

    renderRuleDetail();

    await screen.findByRole("heading", { name: "Flapping check" });
    expect(
      screen.queryByRole("button", { name: /annotations/i }),
    ).not.toBeInTheDocument();
  });
});
