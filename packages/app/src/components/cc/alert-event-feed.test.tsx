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

// ---------------------------------------------------------------------------
// Mocks: the stored-history query. `vi.mock` calls are hoisted above the
// imports above by vitest, so the mocked modules are in place before
// AlertEventFeed (and its dependencies) load.
// ---------------------------------------------------------------------------

// The feed imports @/data/cc/queries -> server fns -> @/db/client, whose
// t3-env access throws under jsdom; stub the db module before that chain loads.
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

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

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

/** Settled event-history query returning `data` (the only axis tests vary). */
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

/**
 * Mount the feed inside a minimal router: resolved sources render as Links to
 * the rule/SLO detail routes, which need a live router to build hrefs. Tests
 * that pass resolveSlo/resolveRuleAddress use this; the rest render bare.
 */
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

  it("names SLO-originated rows by their SLO with an SLO origin marker, linked to the SLO detail page", async () => {
    mockHistory([
      historyRow({ slug: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee" }),
      historyRow({ slug: "beta" }),
    ]);

    renderInRouter(
      <AlertEventFeed
        resolveSlo={(handle) =>
          handle === "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
            ? ccSlo()
            : undefined
        }
        resolveRuleName={(handle) => (handle === "beta" ? "Beta rule" : handle)}
      />,
    );

    // The SLO row resolves to its name plus the origin marker and links to
    // the SLO detail page; the rule row keeps its resolved rule name,
    // unmarked (and unlinked without resolveRuleAddress).
    const sloLink = await screen.findByRole("link", {
      name: "checkout-availability",
    });
    expect(sloLink).toHaveAttribute(
      "href",
      "/alerts/slos/default/checkout-availability",
    );
    expect(screen.getByText("SLO")).toBeInTheDocument();
    expect(screen.getByText("Beta rule")).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Beta rule" }),
    ).not.toBeInTheDocument();
  });

  it("names an SLO row by its display name when the SLO carries one", async () => {
    mockHistory([historyRow({ slug: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee" })]);

    renderInRouter(
      <AlertEventFeed
        resolveSlo={(handle) =>
          handle === "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
            ? ccSlo({
                spec: {
                  ...ccSlo().spec,
                  annotations: {
                    "everr.display.name": "Checkout Availability",
                  },
                },
              })
            : undefined
        }
      />,
    );

    const sloLink = await screen.findByRole("link", {
      name: "Checkout Availability",
    });
    expect(sloLink).toHaveAttribute(
      "href",
      "/alerts/slos/default/checkout-availability",
    );
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

  it("filters by event type, hiding non-matching rows", async () => {
    mockHistory([
      historyRow({ slug: "beta", eventType: "instance_fired" }),
      historyRow({ slug: "gamma", eventType: "delivery" }),
      historyRow({ slug: "delta", eventType: "rule_health" }),
    ]);
    const user = userEvent.setup();

    render(<AlertEventFeed />);

    await user.click(screen.getByRole("combobox", { name: "Event type" }));
    await user.click(await screen.findByRole("option", { name: "Delivery" }));

    expect(screen.queryByText("beta")).not.toBeInTheDocument();
    expect(screen.getByText("gamma")).toBeInTheDocument();
    expect(screen.queryByText("delta")).not.toBeInTheDocument();
  });

  it("type lens narrows to the lens's event types", async () => {
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
  });

  it("type lens composes AND with the fine event-type filter", async () => {
    mockHistory([
      historyRow({ slug: "beta", eventType: "instance_fired" }),
      historyRow({ slug: "gamma", eventType: "instance_resolved" }),
    ]);
    const user = userEvent.setup();

    render(<AlertEventFeed showTypeLens />);

    await user.click(screen.getByRole("button", { name: "Transitions" }));
    await user.click(screen.getByRole("combobox", { name: "Event type" }));
    await user.click(await screen.findByRole("option", { name: "Resolved" }));

    expect(screen.getByText("gamma")).toBeInTheDocument();
    expect(screen.queryByText("beta")).not.toBeInTheDocument();
  });

  it("resolves rule handles to display names via resolveRuleName", () => {
    mockHistory([historyRow({ slug: "beta" })]);

    render(
      <AlertEventFeed
        resolveRuleName={(handle) =>
          handle === "beta" ? "Beta errors" : handle
        }
      />,
    );

    expect(screen.getByText("Beta errors")).toBeInTheDocument();
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

    // Only the row matching BOTH filters remains.
    expect(screen.getByText("beta")).toBeInTheDocument();
    expect(screen.queryByText("gamma")).not.toBeInTheDocument();
    expect(screen.queryByText("delta")).not.toBeInTheDocument();
  });

  it("falls back to the rule's severity for a fire/resolve transition whose own severity is a stored-history gap", () => {
    mockHistory([
      historyRow({
        slug: "beta",
        eventType: "instance_fired",
        severity: "", // CC doesn't stamp alert.severity on stored records yet
      }),
    ]);

    render(
      <AlertEventFeed
        resolveRuleSeverity={(handle) =>
          handle === "beta" ? "critical" : undefined
        }
      />,
    );

    expect(screen.getByText("critical")).toBeInTheDocument();
  });

  it("does not apply the rule severity fallback to non-transition events", () => {
    mockHistory([
      historyRow({
        slug: "beta",
        eventType: "delivery",
        severity: "",
      }),
    ]);

    render(<AlertEventFeed resolveRuleSeverity={() => "critical"} />);

    // A delivery record carries no status, so it isn't a fire/resolve
    // transition: no rule-severity fallback applies, and the gap is real.
    expect(screen.queryByText("critical")).not.toBeInTheDocument();
  });
});
