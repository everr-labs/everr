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
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { alertingRuleViewFixture as alertingRule } from "@/data/alerting/test-fixtures";
import type { AlertingAlert } from "@/data/alerting/types";
import { RULES_PAGE } from "./-components/triage/quiet-rules";
import { Route as AlertsRulesFileRoute } from "./rules";

const mocks = vi.hoisted(() => ({
  listAlertingAlerts: vi.fn(),
  listAlertingRules: vi.fn(),
  pauseAlertingRule: vi.fn(),
  resumeAlertingRule: vi.fn(),
}));

vi.mock("@/data/alerting/instances/server", () => ({
  listAlertingAlerts: mocks.listAlertingAlerts,
}));
vi.mock("@/data/alerting/rules/server", () => ({
  listAlertingRules: mocks.listAlertingRules,
  pauseAlertingRule: mocks.pauseAlertingRule,
  resumeAlertingRule: mocks.resumeAlertingRule,
}));

function alertingAlert(overrides: Partial<AlertingAlert> = {}): AlertingAlert {
  // The engine never sets `active_since` until an instance fires; a pending
  // instance's timeline lives in `pending_since` instead. So a "pending"
  // override must not inherit the firing defaults below.
  const status = overrides.status ?? "firing";
  return {
    key: "rule-1:fp-1",
    fingerprint: "fp-1",
    rule: "rule-1",
    tenant: "org1",
    status: "firing",
    labels: { host: "web-1" },
    value: 42,
    active_since:
      status === "pending"
        ? null
        : new Date(Date.now() - 300_000).toISOString(),
    pending_since:
      status === "pending"
        ? new Date(Date.now() - 120_000).toISOString()
        : null,
    last_seen: new Date().toISOString(),
    absent_count: 0,
    ...overrides,
  };
}

function renderRulesPage(options: { initialEntry?: string } = {}) {
  const { initialEntry = "/alerts/rules" } = options;
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
  const rulesRoute = createRoute({
    getParentRoute: () => alertsLayoutRoute,
    path: "rules",
    component: AlertsRulesFileRoute.options.component,
  });
  const routeTree = rootRoute.addChildren([
    authenticatedRoute.addChildren([
      dashboardRoute.addChildren([alertsLayoutRoute.addChildren([rulesRoute])]),
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

/** The row that holds one rule's line, scoped by its display name so a status
 *  label rendered against the wrong rule cannot pass a bare getByText. */
function ruleRow(name: string) {
  return screen.getByRole("listitem", { name });
}

beforeEach(() => {
  for (const fn of Object.values(mocks)) fn.mockReset();
});

describe("/alerts/rules", () => {
  it("lists a firing rule and a quiet rule, and says which is firing", async () => {
    mocks.listAlertingRules.mockResolvedValue([
      alertingRule({ id: "rule-1", name: "default/noisy" }),
      alertingRule({ id: "rule-2", name: "default/calm" }),
    ]);
    mocks.listAlertingAlerts.mockResolvedValue([
      alertingAlert({ rule: "rule-1", status: "firing" }),
    ]);

    renderRulesPage();

    expect(await screen.findByText("noisy")).toBeInTheDocument();
    expect(screen.getByText("calm")).toBeInTheDocument();
    // Assert the pairing, not just that both words are on the page: a status
    // label rendered against the wrong rule would pass a bare getByText.
    expect(ruleRow("noisy")).toHaveTextContent("Firing");
    expect(ruleRow("calm")).toHaveTextContent("OK");
  });

  it("pages the rule list past its cap", async () => {
    const overflow = 10;
    const total = RULES_PAGE + overflow;
    mocks.listAlertingRules.mockResolvedValue(
      Array.from({ length: total }, (_, i) =>
        alertingRule({
          id: `quiet-${String(i).padStart(2, "0")}`,
          name: `default/quiet-${String(i).padStart(2, "0")}`,
          spec: {
            annotations: {
              "everr.display.name": `Quiet ${String(i).padStart(2, "0")}`,
            },
          },
        }),
      ),
    );
    mocks.listAlertingAlerts.mockResolvedValue([]);
    const firstHidden = `Quiet ${String(RULES_PAGE).padStart(2, "0")}`;

    const user = userEvent.setup();
    renderRulesPage();

    const region = await screen.findByRole("region", { name: "All rules" });
    // The card itself renders before its data does, so its first row must be
    // awaited rather than read straight off the loading skeleton.
    expect(await within(region).findByText("Quiet 00")).toBeInTheDocument();
    expect(within(region).queryByText(firstHidden)).not.toBeInTheDocument();
    expect(
      within(region).getByText(`${overflow} more of ${total}`),
    ).toBeInTheDocument();

    await user.click(within(region).getByRole("button", { name: "Load more" }));

    expect(within(region).getByText(firstHidden)).toBeInTheDocument();
  });

  it("labels a degraded rule and, under ?preview=, a preview rule too", async () => {
    const degraded = alertingRule({
      id: "rule-degraded",
      name: "default/degraded",
      health: {
        status: "degraded",
        consecutive_failures: 3,
        degraded_since: new Date().toISOString(),
        last_error: "boom",
        last_error_at: new Date().toISOString(),
      },
    });
    const previewOnly = alertingRule({
      id: "rule-preview",
      name: "default/preview",
      previewId: "pr-1",
    });
    // The real server only returns `previewOnly` when asked for that
    // preview's scope: the fixture must react to the call args, or this
    // test would pass even if the page never asked for the preview scope.
    mocks.listAlertingRules.mockImplementation(async (opts) =>
      opts?.data?.preview === "pr-1" ? [degraded, previewOnly] : [degraded],
    );
    mocks.listAlertingAlerts.mockResolvedValue([]);

    renderRulesPage({ initialEntry: "/alerts/rules?preview=pr-1" });

    const region = await screen.findByRole("region", { name: "All rules" });
    // The card renders before its data does, so the first label read must be
    // awaited rather than taken off the loading skeleton.
    expect(await within(region).findByText("Degraded")).toBeInTheDocument();
    expect(within(region).getByText("Preview")).toBeInTheDocument();
  });

  it("keeps a preview-only rule off the list without ?preview=", async () => {
    mocks.listAlertingAlerts.mockResolvedValue([]);
    const liveRule = alertingRule({ id: "rule-live", name: "default/live" });
    const previewOnly = alertingRule({
      id: "rule-preview",
      name: "default/preview",
      previewId: "pr-1",
    });
    mocks.listAlertingRules.mockImplementation(async (opts) =>
      opts?.data?.preview === "pr-1" ? [liveRule, previewOnly] : [liveRule],
    );

    renderRulesPage();

    const region = await screen.findByRole("region", { name: "All rules" });
    await within(region).findByText("live");
    expect(within(region).queryByText("Preview")).not.toBeInTheDocument();
    expect(mocks.listAlertingRules).toHaveBeenCalledWith(undefined);
  });

  it("tells the reader how to define rules when there are none", async () => {
    mocks.listAlertingRules.mockResolvedValue([]);
    mocks.listAlertingAlerts.mockResolvedValue([]);

    renderRulesPage();

    const region = await screen.findByRole("region", { name: "All rules" });
    expect(await within(region).findByText("everr apply")).toBeInTheDocument();
  });
});
