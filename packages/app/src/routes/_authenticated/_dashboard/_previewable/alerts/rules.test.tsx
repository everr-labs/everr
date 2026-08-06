import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { alertingRuleViewFixture } from "@/data/alerting/test-fixtures";
import type {
  AlertingRulesPage,
  AlertingRuleView,
} from "@/data/alerting/types";
import { Route as RulesFileRoute } from "./rules";

const mocks = vi.hoisted(() => ({
  listAlertingRulesPage: vi.fn(),
  pauseAlertingRule: vi.fn(),
  resumeAlertingRule: vi.fn(),
}));

vi.mock("@/data/alerting/server", () => ({
  listAlertingRulesPage: mocks.listAlertingRulesPage,
  pauseAlertingRule: mocks.pauseAlertingRule,
  resumeAlertingRule: mocks.resumeAlertingRule,
}));

function alertingRuleView(
  overrides: Partial<AlertingRuleView> = {},
): AlertingRuleView {
  return alertingRuleViewFixture({
    id: "11111111-1111-1111-1111-111111111111",
    spec: {
      interval_secs: 30,
      condition: { operator: "gt", threshold: 0 },
      severity: "info",
    },
    rollup: {
      alert_state: "inactive",
      firing_instance_count: 0,
      last_fired_at: null,
      last_resolved_at: null,
      last_seen_at: null,
      last_row_count: null,
    },
    ...overrides,
  });
}

function page(
  items: AlertingRuleView[],
  nextCursor: string | null,
): AlertingRulesPage {
  return { items, next_cursor: nextCursor };
}

function renderRulesRoute() {
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
  const rulesRoute = createRoute({
    getParentRoute: () => dashboardRoute,
    path: "alerts/rules",
    component: RulesFileRoute.options.component,
  });
  const ruleDetailRoute = createRoute({
    getParentRoute: () => dashboardRoute,
    path: "alerts/rules/$project/$slug",
    component: () => null,
  });
  const runbookRoute = createRoute({
    getParentRoute: () => dashboardRoute,
    path: "runbooks/$project/$slug",
    component: () => null,
  });

  const routeTree = rootRoute.addChildren([
    authenticatedRoute.addChildren([
      dashboardRoute.addChildren([rulesRoute, ruleDetailRoute, runbookRoute]),
    ]),
  ]);

  const history = createMemoryHistory({
    initialEntries: ["/alerts/rules"],
  });
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const router = createRouter({
    routeTree,
    history,
    context: { queryClient },
  });

  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { router, queryClient };
}

describe("/alerts/rules route", () => {
  beforeEach(() => {
    mocks.listAlertingRulesPage.mockReset();
    mocks.pauseAlertingRule.mockReset();
    mocks.resumeAlertingRule.mockReset();
  });

  it("shows a runbook icon link only when the rule links a runbook", async () => {
    mocks.listAlertingRulesPage.mockResolvedValue(
      page(
        [
          alertingRuleView({
            spec: {
              ...alertingRuleView().spec,
              annotations: {
                "everr.name": "flapping",
                "everr.runbook": "demo/flapping-runbook",
              },
            },
          }),
          alertingRuleView({ id: "22222222-2222-2222-2222-222222222222" }),
        ],
        null,
      ),
    );

    renderRulesRoute();

    const runbookLinks = await screen.findAllByRole("link", {
      name: /Open runbook/,
    });
    expect(runbookLinks).toHaveLength(1);
    expect(runbookLinks[0]).toHaveAttribute(
      "href",
      "/runbooks/demo/flapping-runbook",
    );
  });

  it("calls a quiet rule OK but lets degraded evaluation override it", async () => {
    mocks.listAlertingRulesPage.mockResolvedValue(
      page(
        [
          alertingRuleView({ name: "default/quiet-rule" }),
          alertingRuleView({
            id: "22222222-2222-2222-2222-222222222222",
            name: "default/broken-rule",
            health: {
              status: "degraded",
              consecutive_failures: 3,
              degraded_since: "2026-06-14T12:00:00Z",
              last_error: "query failed",
              last_error_at: "2026-06-14T12:00:00Z",
            },
          }),
        ],
        null,
      ),
    );

    renderRulesRoute();

    const quietLink = await screen.findByRole("link", { name: "quiet-rule" });
    expect(quietLink.closest("tr")).toHaveTextContent("OK");
    const brokenLink = screen.getByRole("link", { name: "broken-rule" });
    expect(brokenLink.closest("tr")).toHaveTextContent("Degraded");
    expect(brokenLink.closest("tr")).not.toHaveTextContent("OK");
  });

  it("only calls out the firing instance count when several are firing", async () => {
    const firingRollup = (count: number) => ({
      alert_state: "firing" as const,
      firing_instance_count: count,
      last_fired_at: null,
      last_resolved_at: null,
      last_seen_at: null,
      last_row_count: count,
    });
    mocks.listAlertingRulesPage.mockResolvedValue(
      page(
        [
          alertingRuleView({
            name: "default/single-instance",
            rollup: firingRollup(1),
          }),
          alertingRuleView({
            id: "22222222-2222-2222-2222-222222222222",
            name: "default/multiple-instances",
            rollup: firingRollup(3),
          }),
        ],
        null,
      ),
    );

    renderRulesRoute();

    const singleLink = await screen.findByRole("link", {
      name: "single-instance",
    });
    expect(singleLink.closest("tr")).toHaveTextContent("Firing");
    expect(singleLink.closest("tr")).not.toHaveTextContent("1 instance");
    const multipleLink = screen.getByRole("link", {
      name: "multiple-instances",
    });
    expect(multipleLink.closest("tr")).toHaveTextContent(
      "Firing · 3 instances",
    );
  });

  it("gates pausing behind the confirmation; resuming needs none", async () => {
    mocks.listAlertingRulesPage.mockResolvedValue(
      page(
        [
          alertingRuleView(),
          alertingRuleView({
            id: "22222222-2222-2222-2222-222222222222",
            paused: true,
          }),
        ],
        null,
      ),
    );
    const user = userEvent.setup();
    renderRulesRoute();

    await user.click(await screen.findByRole("button", { name: "Pause" }));
    const cancelled = await screen.findByRole("alertdialog");
    await user.click(within(cancelled).getByRole("button", { name: "Cancel" }));
    expect(mocks.pauseAlertingRule).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Resume" }));
    await waitFor(() => expect(mocks.resumeAlertingRule).toHaveBeenCalled());

    await user.click(screen.getByRole("button", { name: "Pause" }));
    const confirmed = await screen.findByRole("alertdialog");
    await user.click(
      within(confirmed).getByRole("button", { name: "Pause rule" }),
    );
    await waitFor(() => expect(mocks.pauseAlertingRule).toHaveBeenCalled());
  });

  it("shows load-more with a next_cursor and fetches the next page with it", async () => {
    const named = (n: string, id: string) =>
      alertingRuleView({
        id,
        spec: {
          ...alertingRuleView().spec,
          annotations: { "everr.display.name": n },
        },
      });
    mocks.listAlertingRulesPage.mockImplementation(
      ({ data }: { data: { cursor?: string } }) =>
        Promise.resolve(
          data.cursor === "tok-1"
            ? page(
                [
                  named(
                    "Second page rule",
                    "22222222-2222-2222-2222-222222222222",
                  ),
                ],
                null,
              )
            : page(
                [
                  named(
                    "First page rule",
                    "11111111-1111-1111-1111-111111111111",
                  ),
                ],
                "tok-1",
              ),
        ),
    );
    const user = userEvent.setup();

    renderRulesRoute();

    const loadMore = await screen.findByRole("button", { name: "Load more" });
    await user.click(loadMore);

    expect(await screen.findByText("Second page rule")).toBeInTheDocument();
    await waitFor(() =>
      expect(mocks.listAlertingRulesPage).toHaveBeenLastCalledWith({
        data: { limit: 100, cursor: "tok-1" },
      }),
    );
    expect(screen.getByText("First page rule")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Load more" }),
    ).not.toBeInTheDocument();
  });
});
