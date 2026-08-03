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
import { ccRuleViewFixture } from "@/data/cc/test-fixtures";
import type { CcRulesPage, CcRuleView } from "@/data/cc/types";
import { Route as RulesFileRoute } from "./rules";

const mocks = vi.hoisted(() => ({
  listCcRulesPage: vi.fn(),
  pauseCcRule: vi.fn(),
  resumeCcRule: vi.fn(),
}));

vi.mock("@/data/cc/server", () => ({
  listCcRulesPage: mocks.listCcRulesPage,
  pauseCcRule: mocks.pauseCcRule,
  resumeCcRule: mocks.resumeCcRule,
}));

function ccRuleView(overrides: Partial<CcRuleView> = {}): CcRuleView {
  return ccRuleViewFixture({
    id: "11111111-1111-1111-1111-111111111111",
    spec: {
      interval_secs: 30,
      value_column: null,
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

function page(items: CcRuleView[], nextCursor: string | null): CcRulesPage {
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
    mocks.listCcRulesPage.mockReset();
    mocks.pauseCcRule.mockReset();
    mocks.resumeCcRule.mockReset();
  });

  it("shows a runbook icon link only when the rule links a runbook", async () => {
    mocks.listCcRulesPage.mockResolvedValue(
      page(
        [
          ccRuleView({
            spec: {
              ...ccRuleView().spec,
              annotations: {
                "everr.name": "flapping",
                "everr.runbook": "demo/flapping-runbook",
              },
            },
          }),
          ccRuleView({ id: "22222222-2222-2222-2222-222222222222" }),
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

  it("gates pausing behind the confirmation; resuming needs none", async () => {
    mocks.listCcRulesPage.mockResolvedValue(
      page(
        [
          ccRuleView(),
          ccRuleView({
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
    expect(mocks.pauseCcRule).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Resume" }));
    await waitFor(() => expect(mocks.resumeCcRule).toHaveBeenCalled());

    await user.click(screen.getByRole("button", { name: "Pause" }));
    const confirmed = await screen.findByRole("alertdialog");
    await user.click(
      within(confirmed).getByRole("button", { name: "Pause rule" }),
    );
    await waitFor(() => expect(mocks.pauseCcRule).toHaveBeenCalled());
  });

  it("shows load-more with a next_cursor and fetches the next page with it", async () => {
    const named = (n: string, id: string) =>
      ccRuleView({
        id,
        spec: {
          ...ccRuleView().spec,
          annotations: { "everr.display.name": n },
        },
      });
    mocks.listCcRulesPage.mockImplementation(
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
      expect(mocks.listCcRulesPage).toHaveBeenLastCalledWith({
        data: { limit: 100, cursor: "tok-1" },
      }),
    );
    expect(screen.getByText("First page rule")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Load more" }),
    ).not.toBeInTheDocument();
  });
});
