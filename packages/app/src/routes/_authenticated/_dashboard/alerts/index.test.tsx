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
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AlertEventLogRow } from "@/data/alerts/history.server";
import type { CcSlo } from "@/data/cc/types";
import { Route as AlertsIndexFileRoute } from "./index";

// ---------------------------------------------------------------------------
// Mocks at the module boundary the route talks to, same as ./slos.test.tsx
// and ./triage.test.tsx.
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({
  listCcAlerts: vi.fn(),
  listCcRules: vi.fn(),
  listCcSlos: vi.fn(),
  getCcSloStatus: vi.fn(),
  listCcRoutes: vi.fn(),
  listCcReceivers: vi.fn(),
  listCcSilences: vi.fn(),
  listCcSubscriptions: vi.fn(),
  listCcEventHistory: vi.fn(),
}));

vi.mock("@/data/cc/server", () => ({
  listCcAlerts: mocks.listCcAlerts,
  listCcRules: mocks.listCcRules,
  listCcSlos: mocks.listCcSlos,
  getCcSloStatus: mocks.getCcSloStatus,
  listCcRoutes: mocks.listCcRoutes,
  listCcReceivers: mocks.listCcReceivers,
  listCcSilences: mocks.listCcSilences,
  listCcSubscriptions: mocks.listCcSubscriptions,
  listCcEventHistory: mocks.listCcEventHistory,
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SLO_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

function ccSlo(overrides: Partial<CcSlo> = {}): CcSlo {
  return {
    id: SLO_ID,
    tenant: "org1",
    namespace: "",
    name: "checkout-availability",
    spec: {
      sli: {
        sql: "SELECT countIf(ok) AS good, count() AS valid FROM t WHERE ts >= {window_start:DateTime} AND ts < {window_end:DateTime}",
        label_columns: ["service"],
      },
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

// A firing status snapshot: fast-burn (critical in the canonical tiers) is
// firing on the sole group, so the SLO shows up both in "Error budgets" and
// in the attention banner.
function firingSloStatus() {
  return {
    computed_at: new Date().toISOString(),
    health: { status: "healthy", degraded_since: null, last_error: null },
    payload: {
      window: "30d",
      target_percent: 99.9,
      window_computed_at: {},
      groups: [
        {
          labels: { service: "checkout" },
          sli: 0.995,
          budget_remaining: 0.5,
          tiers: [
            {
              name: "fast-burn",
              long_burn_rate: 20,
              short_burn_rate: 18,
              long_window_valid: true,
            },
          ],
          time_to_exhaustion_secs: 3_600,
          firing_tiers: [{ tier: "fast-burn", status: "firing" }],
        },
      ],
    },
  };
}

function eventRow(overrides: Partial<AlertEventLogRow> = {}): AlertEventLogRow {
  return {
    timestamp: new Date(Date.now() - 60_000).toISOString(),
    eventType: "instance_fired",
    slug: "checkout-availability",
    instanceFingerprint: "fp-slo-1",
    labels: { service: "checkout" },
    severity: "critical",
    suppressed: false,
    silenced: false,
    deliveryTargets: [],
    evidence: null,
    evidenceTruncated: false,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

function renderOverviewRoute() {
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
  const overviewRoute = createRoute({
    getParentRoute: () => alertsLayoutRoute,
    path: "/",
    component: AlertsIndexFileRoute.options.component,
  });
  // Link target (SLO detail); never rendered here.
  const sloDetailRoute = createRoute({
    getParentRoute: () => alertsLayoutRoute,
    path: "slos/$project/$slug",
    component: () => null,
  });

  const routeTree = rootRoute.addChildren([
    authenticatedRoute.addChildren([
      dashboardRoute.addChildren([
        alertsLayoutRoute.addChildren([overviewRoute, sloDetailRoute]),
      ]),
    ]),
  ]);

  const history = createMemoryHistory({ initialEntries: ["/alerts/"] });
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

async function cardOf(headingText: string): Promise<HTMLElement> {
  const heading = await screen.findByRole("heading", { name: headingText });
  const card = heading.closest('[data-slot="card"]');
  if (card === null) throw new Error(`no card ancestor for "${headingText}"`);
  return card as HTMLElement;
}

beforeEach(() => {
  for (const fn of Object.values(mocks)) fn.mockReset();
  mocks.listCcAlerts.mockResolvedValue([]);
  mocks.listCcRules.mockResolvedValue([]);
  mocks.listCcSlos.mockResolvedValue([ccSlo()]);
  mocks.getCcSloStatus.mockResolvedValue(firingSloStatus());
  mocks.listCcRoutes.mockResolvedValue([]);
  mocks.listCcReceivers.mockResolvedValue([]);
  mocks.listCcSilences.mockResolvedValue([]);
  mocks.listCcSubscriptions.mockResolvedValue([]);
  mocks.listCcEventHistory.mockResolvedValue([eventRow()]);
});

describe("/alerts overview — SLO identity across the page", () => {
  it("shows the SLO's display name in the error-budget row, the attention banner, and recent events when set", async () => {
    mocks.listCcSlos.mockResolvedValue([
      ccSlo({
        spec: {
          ...ccSlo().spec,
          annotations: { "everr.display.name": "Checkout Availability" },
        },
      }),
    ]);

    renderOverviewRoute();

    // Error budgets: the posture row leads with the display name, links to
    // the slug-addressed detail route.
    const budgets = await cardOf("Error budgets");
    const budgetLink = await within(budgets).findByRole("link", {
      name: /Checkout Availability/,
    });
    expect(budgetLink).toHaveAttribute(
      "href",
      "/alerts/slos/default/checkout-availability",
    );
    expect(
      within(budgets).getByText("Checkout Availability"),
    ).toBeInTheDocument();

    // Attention banner: the firing SLO's row is named by its display name,
    // still linking on the real slug-addressed resource.
    const attentionLink = await screen.findByRole("link", {
      name: /Checkout Availability is burning error budget/,
    });
    expect(attentionLink).toHaveAttribute(
      "href",
      "/alerts/slos/default/checkout-availability",
    );

    // Recent events: the feed's own SLO-name rendering (not AlertEventFeed)
    // also uses the display name.
    const recent = await cardOf("Recent events");
    const eventLink = await within(recent).findByRole("link", {
      name: "Checkout Availability",
    });
    expect(eventLink).toHaveAttribute(
      "href",
      "/alerts/slos/default/checkout-availability",
    );
  });

  it("shows an error (not a false 'no events') when the history query fails", async () => {
    mocks.listCcEventHistory.mockRejectedValue(new Error("clickhouse down"));

    renderOverviewRoute();

    const recent = await cardOf("Recent events");
    expect(
      await within(recent).findByText(/Event history unavailable/),
    ).toBeInTheDocument();
    expect(
      within(recent).queryByText(/No stored events/),
    ).not.toBeInTheDocument();
  });

  it("falls back to the slug in all three places when no display name is set", async () => {
    renderOverviewRoute();

    const budgets = await cardOf("Error budgets");
    expect(
      await within(budgets).findByRole("link", {
        name: /^checkout-availability/,
      }),
    ).toBeInTheDocument();

    const attentionLink = await screen.findByRole("link", {
      name: /checkout-availability is burning error budget/,
    });
    expect(attentionLink).toHaveAttribute(
      "href",
      "/alerts/slos/default/checkout-availability",
    );

    const recent = await cardOf("Recent events");
    expect(
      await within(recent).findByRole("link", {
        name: "checkout-availability",
      }),
    ).toBeInTheDocument();
  });
});
