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
import type { AlertEventLogRow } from "@/data/alerts/history.server";
import type { CcSlo } from "@/data/cc/types";
import { AlertEventFeed } from "./alert-event-feed";

// Avoid loading the database and environment chain under jsdom.
vi.mock("@/db/client", () => ({ db: {} }));

const mockUseQuery = vi.fn();
vi.mock("@tanstack/react-query", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-query")>();
  return { ...actual, useQuery: (opts: unknown) => mockUseQuery(opts) };
});

vi.mock("@/hooks/use-time-range", () => ({
  useTimeRange: () => ({
    timeRange: { from: "now-1h", to: "now" },
    setTimeRange: vi.fn(),
  }),
}));

function ccSlo(overrides: Partial<CcSlo> = {}): CcSlo {
  return {
    id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    tenant: "org1",
    namespace: "",
    name: "checkout-availability",
    spec: {
      sli: { sql: "SELECT 1 AS good, 1 AS valid", label_columns: [] },
      targetPercent: 99.9,
      timeWindow: { duration: "30d", isRolling: true },
      annotations: {},
      suppressed: false,
    },
    version: 1,
    paused: false,
    ...overrides,
  };
}

function historyRow(
  overrides: Partial<AlertEventLogRow> = {},
): AlertEventLogRow {
  return {
    timestamp: "2024-01-01T00:00:00Z",
    eventType: "instance_fired",
    slug: "beta",
    instanceFingerprint: "fp-beta",
    labels: { team: "core" },
    severity: "warning",
    suppressed: false,
    silenced: false,
    deliveryTargets: [],
    evidence: null,
    evidenceTruncated: false,
    ...overrides,
  };
}

function mockHistory(data: AlertEventLogRow[]) {
  mockUseQuery.mockReturnValue({
    data,
    isPending: false,
    isError: false,
    error: null,
  });
}

beforeEach(() => {
  mockUseQuery.mockReset();
  mockHistory([]);
});

/** Mount links with their detail routes. */
function renderInRouter(ui: React.ReactElement) {
  const rootRoute = createRootRoute({ component: Outlet });
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    component: () => ui,
  });
  const sloDetailRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/alerts/slos/$project/$slug",
    component: () => null,
  });
  const ruleDetailRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/alerts/rules/$project/$slug",
    component: () => null,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([
      indexRoute,
      sloDetailRoute,
      ruleDetailRoute,
    ]),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  render(<RouterProvider router={router} />);
}

describe("AlertEventFeed", () => {
  it("filters to scopeSlug, hiding other slugs", () => {
    mockHistory([historyRow({ slug: "alpha" }), historyRow({ slug: "beta" })]);

    render(<AlertEventFeed scopeSlug={["alpha"]} />);

    expect(screen.getByText("alpha")).toBeInTheDocument();
    expect(screen.queryByText("beta")).not.toBeInTheDocument();
  });

  it("links SLO-originated rows by SLO name with an origin marker", async () => {
    mockHistory([historyRow({ slug: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee" })]);

    renderInRouter(
      <AlertEventFeed
        resolveSlo={(handle) =>
          handle === "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
            ? ccSlo()
            : undefined
        }
      />,
    );

    const sloLink = await screen.findByRole("link", {
      name: "checkout-availability",
    });
    expect(sloLink).toHaveAttribute(
      "href",
      "/alerts/slos/default/checkout-availability",
    );
    expect(screen.getByText("SLO")).toBeInTheDocument();
  });

  it("links resolved rule rows to the rule detail page via resolveRuleAddress", async () => {
    mockHistory([historyRow({ slug: "beta" })]);

    renderInRouter(
      <AlertEventFeed
        resolveRuleName={(handle) => (handle === "beta" ? "Beta rule" : handle)}
        resolveRuleAddress={(handle) =>
          handle === "beta" ? { project: "default", slug: "rule-1" } : undefined
        }
      />,
    );

    const ruleLink = await screen.findByRole("link", { name: "Beta rule" });
    expect(ruleLink).toHaveAttribute("href", "/alerts/rules/default/rule-1");
  });

  it("type lens narrows to its event types and composes with the fine filter", async () => {
    mockHistory([
      historyRow({ slug: "beta", eventType: "instance_fired" }),
      historyRow({ slug: "gamma", eventType: "instance_resolved" }),
      historyRow({ slug: "delta", eventType: "delivery" }),
      historyRow({ slug: "epsilon", eventType: "silenced" }),
      historyRow({ slug: "zeta", eventType: "rule_health" }),
    ]);
    const user = userEvent.setup();

    render(<AlertEventFeed showTypeLens />);

    await user.click(screen.getByRole("button", { name: "Transitions" }));
    expect(screen.getByText("beta")).toBeInTheDocument();
    expect(screen.getByText("gamma")).toBeInTheDocument();
    expect(screen.queryByText("delta")).not.toBeInTheDocument();
    expect(screen.queryByText("epsilon")).not.toBeInTheDocument();
    expect(screen.queryByText("zeta")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Deliveries" }));
    expect(screen.getByText("delta")).toBeInTheDocument();
    expect(screen.queryByText("beta")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Silence audits" }));
    expect(screen.getByText("epsilon")).toBeInTheDocument();
    expect(screen.queryByText("delta")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "All" }));
    expect(screen.getByText("zeta")).toBeInTheDocument();

    // The lens and the fine event-type filter narrow independently (AND).
    await user.click(screen.getByRole("button", { name: "Transitions" }));
    await user.click(screen.getByRole("combobox", { name: "Event type" }));
    await user.click(await screen.findByRole("option", { name: "Resolved" }));
    expect(screen.getByText("gamma")).toBeInTheDocument();
    expect(screen.queryByText("beta")).not.toBeInTheDocument();
  });

  it("composes the event-type filter with severity (AND)", async () => {
    mockHistory([
      historyRow({
        slug: "beta",
        eventType: "instance_fired",
        severity: "critical",
      }),
      historyRow({
        slug: "gamma",
        eventType: "instance_fired",
        severity: "warning",
      }),
      historyRow({
        slug: "delta",
        eventType: "delivery",
        severity: "critical",
      }),
    ]);
    const user = userEvent.setup();

    render(<AlertEventFeed />);

    await user.click(screen.getByRole("combobox", { name: "Event type" }));
    await user.click(await screen.findByRole("option", { name: "Fired" }));

    await user.click(screen.getByRole("combobox", { name: "Severity" }));
    await user.click(await screen.findByRole("option", { name: "Critical" }));

    expect(screen.getByText("beta")).toBeInTheDocument();
    expect(screen.queryByText("gamma")).not.toBeInTheDocument();
    expect(screen.queryByText("delta")).not.toBeInTheDocument();
  });

  it("falls back to the rule's severity only for fire/resolve transitions", () => {
    mockHistory([
      // CC doesn't stamp alert.severity on stored records yet.
      historyRow({ slug: "beta", eventType: "instance_fired", severity: "" }),
      historyRow({ slug: "beta", eventType: "delivery", severity: "" }),
    ]);

    render(
      <AlertEventFeed
        resolveRuleSeverity={(handle) =>
          handle === "beta" ? "critical" : undefined
        }
      />,
    );

    // Only the transition takes the fallback: the rule's severity says
    // nothing about a delivery.
    expect(screen.getAllByText("critical")).toHaveLength(1);
  });
});
