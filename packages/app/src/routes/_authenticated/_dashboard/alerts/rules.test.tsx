import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CcRulesPage, CcRuleView } from "@/data/cc/types";
import { Route as RulesFileRoute } from "./rules";

// ---------------------------------------------------------------------------
// Mocks at the module boundary the route talks to: the data module, built
// with `vi.hoisted` so the `vi.mock`
// factory (hoisted above these declarations) can reference them safely.
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function ccRuleView(overrides: Partial<CcRuleView> = {}): CcRuleView {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    tenant: "org1",
    spec: {
      sql: "SELECT 1",
      interval_secs: 30,
      for_secs: 0,
      label_columns: [],
      value_column: null,
      severity: "info",
      annotations: {},
      resolve_after: 1,
      suppressed: false,
    },
    version: 1,
    paused: false,
    updated_at: "2026-06-14T12:00:00Z",
    health: {
      status: "healthy",
      consecutive_failures: 0,
      degraded_since: null,
      last_error: null,
      last_error_at: null,
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
  };
}

function page(items: CcRuleView[], nextCursor: string | null): CcRulesPage {
  return { items, next_cursor: nextCursor };
}

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

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
  // Link targets (per-rule detail, runbooks); never rendered here.
  const ruleDetailRoute = createRoute({
    getParentRoute: () => dashboardRoute,
    path: "alerts/rules/$ruleId",
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

  it("renders the firing rollup state with its instance count", async () => {
    mocks.listCcRulesPage.mockResolvedValue(
      page(
        [
          ccRuleView({
            rollup: {
              alert_state: "firing",
              firing_instance_count: 2,
              last_fired_at: "2026-06-14T12:00:00Z",
              last_resolved_at: null,
              last_seen_at: "2026-06-14T12:03:00Z",
              last_row_count: 5,
            },
          }),
        ],
        null,
      ),
    );

    renderRulesRoute();

    expect(await screen.findByText("firing · 2")).toBeInTheDocument();
    expect(mocks.listCcRulesPage).toHaveBeenCalledWith({
      data: { limit: 100 },
    });
  });

  it("names rules by display name with the id as muted secondary", async () => {
    mocks.listCcRulesPage.mockResolvedValue(
      page(
        [
          ccRuleView({
            spec: {
              ...ccRuleView().spec,
              annotations: {
                "everr.name": "flapping",
                "everr.display.name": "Flapping Detector",
              },
            },
          }),
        ],
        null,
      ),
    );

    renderRulesRoute();

    expect(
      await screen.findByRole("link", { name: "Flapping Detector" }),
    ).toBeInTheDocument();
    // The id survives as the muted secondary line.
    expect(screen.getByText("11111111")).toBeInTheDocument();
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

  it("renders the non-firing rollup state as muted text", async () => {
    mocks.listCcRulesPage.mockResolvedValue(page([ccRuleView()], null));

    renderRulesRoute();

    expect(await screen.findByText("inactive")).toBeInTheDocument();
    expect(screen.queryByText(/firing ·/)).not.toBeInTheDocument();
  });

  it("hides the load-more control when next_cursor is null", async () => {
    mocks.listCcRulesPage.mockResolvedValue(page([ccRuleView()], null));

    renderRulesRoute();

    await screen.findByText("inactive");
    expect(
      screen.queryByRole("button", { name: "Load more" }),
    ).not.toBeInTheDocument();
  });

  it("shows load-more with a next_cursor and fetches the next page with it", async () => {
    mocks.listCcRulesPage.mockImplementation(
      ({ data }: { data: { cursor?: string } }) =>
        Promise.resolve(
          data.cursor === "tok-1"
            ? page(
                [ccRuleView({ id: "22222222-2222-2222-2222-222222222222" })],
                null,
              )
            : page([ccRuleView()], "tok-1"),
        ),
    );
    const user = userEvent.setup();

    renderRulesRoute();

    const loadMore = await screen.findByRole("button", { name: "Load more" });
    await user.click(loadMore);

    expect(await screen.findByText("22222222")).toBeInTheDocument();
    await waitFor(() =>
      expect(mocks.listCcRulesPage).toHaveBeenLastCalledWith({
        data: { limit: 100, cursor: "tok-1" },
      }),
    );
    // Both pages stay on screen; the exhausted cursor removes the control.
    expect(screen.getByText("11111111")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Load more" }),
    ).not.toBeInTheDocument();
  });
});
