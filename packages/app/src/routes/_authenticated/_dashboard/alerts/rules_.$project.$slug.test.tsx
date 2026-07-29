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
import type { CcAlert, CcRuleView } from "@/data/cc/types";
import { Route as RuleDetailFileRoute } from "./rules_.$project.$slug";

// ---------------------------------------------------------------------------
// Mocks: the data module, sonner, and the event feed (its SSE hook and
// time-range plumbing are covered by its own tests; here we only assert the
// detail page scopes it to this rule).
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({
  getCcRuleByName: vi.fn(),
  listCcAlerts: vi.fn(),
  pauseCcRule: vi.fn(),
  resumeCcRule: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  feedProps: vi.fn(),
}));

vi.mock("@/data/cc/server", () => ({
  getCcRuleByName: mocks.getCcRuleByName,
  listCcAlerts: mocks.listCcAlerts,
  pauseCcRule: mocks.pauseCcRule,
  resumeCcRule: mocks.resumeCcRule,
}));

vi.mock("sonner", () => ({
  toast: {
    success: (...a: unknown[]) => mocks.toastSuccess(...a),
    error: (...a: unknown[]) => mocks.toastError(...a),
  },
}));

vi.mock("@/components/cc/alert-event-feed", () => ({
  AlertEventFeed: (props: unknown) => {
    mocks.feedProps(props);
    return <div data-testid="event-feed" />;
  },
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const RULE_ID = "e2abbe03-1111-2222-3333-444444444444";
const PROJECT = "default";
const SLUG = "api-errors";

function ruleView(overrides: Partial<CcRuleView> = {}): CcRuleView {
  return {
    id: RULE_ID,
    tenant: "org1",
    namespace: "",
    name: `${PROJECT}/${SLUG}`,
    spec: {
      sql: "SELECT svc, count() AS val FROM errors GROUP BY svc",
      interval_secs: 30,
      for_secs: 60,
      label_columns: ["svc"],
      value_column: "val",
      severity: "critical",
      annotations: {
        "everr.display.name": "Flapping Detector",
        "everr.runbook": "demo/flapping-runbook",
      },
      resolve_after: 2,
      max_interval_secs: 300,
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
      alert_state: "firing",
      firing_instance_count: 1,
      last_fired_at: "2026-06-14T12:00:00Z",
      last_resolved_at: "2026-06-13T09:00:00Z",
      last_seen_at: "2026-06-14T12:03:00Z",
      last_row_count: 5,
    },
    ...overrides,
  };
}

function alert(overrides: Partial<CcAlert> = {}): CcAlert {
  return {
    key: "inst-1",
    rule: RULE_ID,
    tenant: "org1",
    status: "firing",
    labels: { svc: "flap" },
    value: 3,
    active_since: "2026-06-14T12:00:00Z",
    last_seen: "2026-06-14T12:03:00Z",
    absent_count: 0,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

function renderRuleDetail() {
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
  const detailRoute = createRoute({
    getParentRoute: () => dashboardRoute,
    path: "alerts/rules/$project/$slug",
    component: RuleDetailFileRoute.options.component,
  });
  // Link targets; never rendered here.
  const rulesRoute = createRoute({
    getParentRoute: () => dashboardRoute,
    path: "alerts/rules",
    component: () => null,
  });
  const runbookRoute = createRoute({
    getParentRoute: () => dashboardRoute,
    path: "runbooks/$project/$slug",
    component: () => null,
  });

  const routeTree = rootRoute.addChildren([
    authenticatedRoute.addChildren([
      dashboardRoute.addChildren([detailRoute, rulesRoute, runbookRoute]),
    ]),
  ]);

  const history = createMemoryHistory({
    initialEntries: [`/alerts/rules/${PROJECT}/${SLUG}`],
  });
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
  vi.clearAllMocks();
  mocks.getCcRuleByName.mockResolvedValue(ruleView());
  mocks.listCcAlerts.mockResolvedValue([alert()]);
});

describe("/alerts/rules/$project/$slug", () => {
  it("renders every prior fact across the question-shaped sections", async () => {
    renderRuleDetail();

    // Header: display name primary, id muted, severity, pause.
    expect(
      await screen.findByRole("heading", { name: "Flapping Detector" }),
    ).toBeInTheDocument();
    expect(screen.getByText(RULE_ID.slice(0, 8))).toBeInTheDocument();
    expect(screen.getByText("critical")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Pause/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Runbook/ })).toBeInTheDocument();

    // What is it: the spec facts.
    expect(screen.getByText("What is it")).toBeInTheDocument();
    expect(screen.getByText("30s")).toBeInTheDocument(); // interval
    expect(screen.getByText("300s")).toBeInTheDocument(); // max interval
    expect(screen.getByText("60s")).toBeInTheDocument(); // for
    expect(screen.getByText("2")).toBeInTheDocument(); // resolve after
    expect(screen.getAllByText("svc").length).toBeGreaterThan(0); // label columns
    expect(screen.getByText("val")).toBeInTheDocument(); // value column
    expect(screen.getByText("everr.runbook:")).toBeInTheDocument();

    // What's it doing: rollup facts + the instance row + the scoped feed.
    expect(screen.getByText("What’s it doing")).toBeInTheDocument();
    expect(screen.getByText("Last fired")).toBeInTheDocument();
    expect(screen.getByText("Last row count")).toBeInTheDocument();
    expect(screen.getByText("5")).toBeInTheDocument();
    expect(screen.getByText("firing")).toBeInTheDocument();
    expect(screen.getByTestId("event-feed")).toBeInTheDocument();
    expect(mocks.feedProps).toHaveBeenCalledWith(
      expect.objectContaining({
        // The rule's qualified name is "default/api-errors", so the bare
        // slug "api-errors" is included too as a legacy event handle.
        scopeSlug: [RULE_ID, `${PROJECT}/${SLUG}`, SLUG],
        // Scoped to one rule: the feed's own Severity/Rule columns and
        // severity filter would be constant noise, so the detail page hides
        // them and hands the feed this rule's severity as a fallback.
        hideRuleColumns: true,
        resolveRuleSeverity: expect.any(Function),
      }),
    );
  });

  it("shows the rollup strip as relative time with the absolute datetime in a title", async () => {
    renderRuleDetail();
    await screen.findByRole("heading", { name: "Flapping Detector" });

    const lastFiredLabel = screen.getByText("Last fired");
    const lastFiredValue = lastFiredLabel.nextElementSibling as HTMLElement;
    // Relative, matching the instances table's "just now"/"Xm ago" idiom...
    expect(lastFiredValue.textContent).toMatch(/ago$/);
    // ...with the absolute datetime still reachable via title.
    expect(lastFiredValue.getAttribute("title")).toMatch(/\d{4}/);
    expect(lastFiredValue.getAttribute("title")).not.toBe(
      lastFiredValue.textContent,
    );

    // Last row count is a plain count, not a timestamp: untouched.
    expect(screen.getByText("5")).toBeInTheDocument();
  });

  it("collapses the SQL behind a disclosure", async () => {
    const user = userEvent.setup();
    renderRuleDetail();
    await screen.findByRole("heading", { name: "Flapping Detector" });

    // Closed: no <pre> wall, just the one-line trigger.
    expect(document.querySelector("pre")).toBeNull();

    await user.click(screen.getByText("SQL"));
    const pre = document.querySelector("pre");
    expect(pre).not.toBeNull();
    expect(pre?.textContent).toContain(
      "SELECT svc, count() AS val FROM errors GROUP BY svc",
    );
  });

  it("carries degraded health as a title glyph, not a card of forensics", async () => {
    mocks.getCcRuleByName.mockResolvedValue(
      ruleView({
        health: {
          status: "degraded",
          consecutive_failures: 4,
          degraded_since: "2026-06-14T11:00:00Z",
          last_error: "Code: 47. Unknown identifier: svc",
          last_error_at: "2026-06-14T12:00:00Z",
        },
      }),
    );
    renderRuleDetail();
    await screen.findByRole("heading", { name: "Flapping Detector" });

    expect(screen.getByLabelText("Evaluation degraded")).toBeInTheDocument();
    // The fact, not the forensics: no section, no consecutive-failure count,
    // no raw query error.
    expect(screen.queryByText("Is it healthy")).not.toBeInTheDocument();
    expect(screen.queryByText(/Unknown identifier/)).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("carries healthy evaluation as the whole heart", async () => {
    renderRuleDetail();
    await screen.findByRole("heading", { name: "Flapping Detector" });

    expect(screen.getByLabelText("Evaluating")).toBeInTheDocument();
  });

  it("flags a suppressed rule loudly", async () => {
    mocks.getCcRuleByName.mockResolvedValue(
      ruleView({
        spec: { ...ruleView().spec, suppressed: true },
      }),
    );
    renderRuleDetail();

    expect(await screen.findByText("suppressed")).toBeInTheDocument();
  });

  it("offers no ad-hoc test run", async () => {
    renderRuleDetail();
    await screen.findByRole("heading", { name: "Flapping Detector" });

    // Rules are as-code: the spec is validated on apply, so a button that
    // re-runs it here answered a question nobody was asking on this page.
    expect(screen.queryByText("Try it")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Run test/ }),
    ).not.toBeInTheDocument();
  });
});
