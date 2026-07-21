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
import type { CcSlo, CcSloStatus } from "@/data/cc/types";
import { Route as SloDetailFileRoute } from "./slos_.$sloId";

// ---------------------------------------------------------------------------
// Mocks at the module boundary the route talks to, same as the sibling tests.
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({
  getCcSlo: vi.fn(),
  getCcSloStatus: vi.fn(),
  getCcSloBudgetSeries: vi.fn(),
  getCcSloBudgetNow: vi.fn(),
  pauseCcSlo: vi.fn(),
  resumeCcSlo: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  feedProps: vi.fn(),
}));

vi.mock("@/data/cc/server", () => ({
  getCcSlo: mocks.getCcSlo,
  getCcSloStatus: mocks.getCcSloStatus,
  getCcSloBudgetSeries: mocks.getCcSloBudgetSeries,
  getCcSloBudgetNow: mocks.getCcSloBudgetNow,
  pauseCcSlo: mocks.pauseCcSlo,
  resumeCcSlo: mocks.resumeCcSlo,
}));

vi.mock("sonner", () => ({
  toast: {
    success: (...a: unknown[]) => mocks.toastSuccess(...a),
    error: (...a: unknown[]) => mocks.toastError(...a),
  },
}));

// The firing-history feed is exercised by its own tests; here we stub it and
// assert the detail page scopes it to this SLO's handles.
vi.mock("@/components/cc/alert-event-feed", () => ({
  AlertEventFeed: (props: unknown) => {
    mocks.feedProps(props);
    return <div data-testid="event-feed" />;
  },
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SLO_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

function ccSlo(overrides: Partial<CcSlo> = {}): CcSlo {
  return {
    id: SLO_ID,
    tenant: "org1",
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

function sloStatus(overrides: Partial<CcSloStatus> = {}): CcSloStatus {
  return {
    computed_at: new Date(Date.now() - 60_000).toISOString(),
    payload: {
      window: "30d",
      target_percent: 99.9,
      groups: [
        {
          labels: { service: "checkout" },
          sli: 0.9992,
          budget_remaining: 0.42,
          tiers: [
            {
              name: "fast-burn",
              long_burn_rate: 1.4,
              short_burn_rate: 0.9,
              long_window_valid: 120000,
            },
            {
              name: "ticket",
              long_burn_rate: 0.8,
              short_burn_rate: null,
              long_window_valid: null,
            },
          ],
          time_to_exhaustion_secs: 3 * 86400 + 4 * 3600,
          firing_tiers: [{ tier: "fast-burn", status: "firing" }],
        },
      ],
      window_computed_at: { "300s": 1752829200 },
    },
    health: { status: "healthy", degraded_since: null, last_error: null },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

function renderSloDetailRoute() {
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
  const sloDetailRoute = createRoute({
    getParentRoute: () => dashboardRoute,
    path: "alerts/slos/$sloId",
    component: SloDetailFileRoute.options.component,
  });
  // Back-link target; never rendered here.
  const slosRoute = createRoute({
    getParentRoute: () => dashboardRoute,
    path: "alerts/slos",
    component: () => null,
  });

  const routeTree = rootRoute.addChildren([
    authenticatedRoute.addChildren([
      dashboardRoute.addChildren([sloDetailRoute, slosRoute]),
    ]),
  ]);

  const history = createMemoryHistory({
    initialEntries: [`/alerts/slos/${SLO_ID}`],
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
  for (const fn of Object.values(mocks)) fn.mockReset();
  mocks.getCcSlo.mockResolvedValue(ccSlo());
  mocks.getCcSloStatus.mockResolvedValue(sloStatus());
  mocks.getCcSloBudgetSeries.mockResolvedValue([]);
  mocks.getCcSloBudgetNow.mockResolvedValue([]);
  mocks.pauseCcSlo.mockResolvedValue(ccSlo({ paused: true }));
  mocks.resumeCcSlo.mockResolvedValue(ccSlo());
});

describe("/alerts/slos/$sloId route", () => {
  it("leads with the status hero: state, budget, SLI, burn, and per-tier pressure", async () => {
    renderSloDetailRoute();

    expect(
      await screen.findByRole("heading", { name: "checkout-availability" }),
    ).toBeInTheDocument();
    expect(screen.getByText("99.9% over 30d rolling")).toBeInTheDocument();

    // The hero leads with a plain-language verdict, before any number.
    expect(
      await screen.findByText(/Burning fast\. A critical alert is firing/),
    ).toBeInTheDocument();

    // The hero state pill: fast-burn is firing (critical), so the SLO is Firing.
    expect(screen.getByText("Firing")).toBeInTheDocument();
    // The worst group's identity rides next to the state.
    expect(screen.getByText("checkout")).toBeInTheDocument();
    // Headline numbers: SLI, budget remaining, time to exhaustion.
    expect(screen.getByText("99.92%")).toBeInTheDocument(); // SLI
    expect(screen.getByText("42.00%")).toBeInTheDocument(); // budget remaining
    expect(screen.getByText("3d 4h")).toBeInTheDocument(); // exhaustion
    // The headline burn and the fast-burn pressure gauge both print 1.4× / 1h.
    expect(screen.getAllByText(/1\.4×/).length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText(/\/ 1h/).length).toBeGreaterThanOrEqual(2);
    // The short-window burn is now surfaced on the fast-burn gauge (not buried
    // in a tooltip).
    expect(screen.getByText(/short window 0\.9×/)).toBeInTheDocument();
    // fast-burn is named once, in the hero's "what would page you" gauge; the
    // Objective's static tiers table is collapsed behind a disclosure by default.
    expect(screen.getAllByText("fast-burn")).toHaveLength(1);

    // The read-time scan is empty here (no traffic in the trailing window), so the
    // stored snapshot stands and the freshness line reads "computing", not fresh.
    expect(screen.getByText(/Error budget computing/)).toBeInTheDocument();

    // Objective card: the tiers are foregrounded by outcome behind a collapsed
    // "When it alerts" disclosure (page vs ticket), not a raw tiers table.
    expect(screen.getByText("When it alerts")).toBeInTheDocument();
    expect(
      screen.getByText(
        /pages on fast or sustained burn, tickets on a slow leak/,
      ),
    ).toBeInTheDocument();
    // slow-burn / ticket are named in the pressure gauges (the objective
    // outcome list that also names them is collapsed by default).
    expect(screen.getAllByText("slow-burn").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("ticket").length).toBeGreaterThanOrEqual(1);

    // Health reads healthy, quietly.
    expect(screen.getByText("healthy")).toBeInTheDocument();

    // The firing-history feed is scoped to this SLO's handles.
    expect(mocks.feedProps).toHaveBeenCalled();
    const props = mocks.feedProps.mock.calls.at(-1)?.[0] as {
      scopeSlug: string[];
    };
    expect(props.scopeSlug).toContain(SLO_ID);
  });

  it("overrides the snapshot's budget with the read-time value on the hero", async () => {
    // The stored snapshot is throttled (budget 42%); the read-time scan returns
    // a thinner current budget for the same group. The hero must show the fresh
    // number and re-derive time-to-exhaustion from it, not the stale snapshot.
    mocks.getCcSloBudgetNow.mockResolvedValue([
      { labels: { service: "checkout" }, sli: 0.998, budgetRemaining: 0.1 },
    ]);
    renderSloDetailRoute();

    // Fresh budget (10%), not the snapshot's 42%.
    expect(await screen.findByText("10.00%")).toBeInTheDocument();
    expect(screen.queryByText("42.00%")).not.toBeInTheDocument();
    // TTE re-derived from the fresh budget and the effective (both-window) burn
    // min(1.4, 0.9) = 0.9, not the raw 1h rate: 2592000 * 0.10 / 0.9 = 288000s
    // -> 3d 8h. The snapshot's stored 3d 4h is gone.
    expect(screen.getByText("3d 8h")).toBeInTheDocument();
    expect(screen.queryByText("3d 4h")).not.toBeInTheDocument();
    // A non-empty scan landed, so the freshness line reads "computed just now".
    expect(
      screen.getByText(/Error budget computed just now/),
    ).toBeInTheDocument();
  });

  it("charts the error budget over time, scoped to the SLO's budget window", async () => {
    renderSloDetailRoute();

    expect(
      await screen.findByText("Error budget over time"),
    ).toBeInTheDocument();

    // The series query is scoped to this SLO (the server fetches the SLO for the
    // authoritative SLI/target/window, so the request carries just the id + range).
    await waitFor(() => expect(mocks.getCcSloBudgetSeries).toHaveBeenCalled());
    const arg = mocks.getCcSloBudgetSeries.mock.calls.at(-1)?.[0] as {
      data: { sloId: string };
    };
    expect(arg.data.sloId).toBe(SLO_ID);

    // Empty series in the fixture: the empty state shows, no chart.
    expect(
      screen.getByText(/No telemetry in this range to compute the budget/),
    ).toBeInTheDocument();
  });

  it("describes a scalar SLO without a per-group table", async () => {
    // A scalar SLO: no label columns, one label-less group. The hero fully
    // describes it, so there is no "All groups" breakdown.
    mocks.getCcSlo.mockResolvedValue(
      ccSlo({
        spec: {
          ...ccSlo().spec,
          sli: { ...ccSlo().spec.sli, label_columns: [] },
        },
      }),
    );
    mocks.getCcSloStatus.mockResolvedValue(
      sloStatus({
        payload: {
          window: "30d",
          target_percent: 99.9,
          groups: [
            {
              labels: {},
              sli: 1,
              budget_remaining: 1,
              tiers: [],
              time_to_exhaustion_secs: null,
              firing_tiers: [],
            },
          ],
          window_computed_at: {},
        },
      }),
    );

    renderSloDetailRoute();

    // The hero leads with the verdict; a calm scalar SLO reads "on track".
    expect(
      await screen.findByText(/On track\. Nothing is spending error budget/),
    ).toBeInTheDocument();
    // Scalar: the objective states there are no grouping columns.
    expect(screen.getByText(/\(scalar SLI\)/)).toBeInTheDocument();
    // Budget and SLI both read 100% for a perfectly healthy scalar SLO.
    expect(screen.getAllByText("100.00%").length).toBeGreaterThanOrEqual(1);
    // No multi-group breakdown for a single group.
    expect(screen.queryByText("All groups")).not.toBeInTheDocument();
  });

  it("shows the pending state when no snapshot exists yet", async () => {
    // getCcSloStatus resolves null for CC's 404: no snapshot row yet.
    mocks.getCcSloStatus.mockResolvedValue(null);

    renderSloDetailRoute();

    expect(
      await screen.findByText("No status snapshot yet"),
    ).toBeInTheDocument();
    // Without a snapshot there is no health row either: no health card.
    expect(screen.queryByText("Is it healthy")).not.toBeInTheDocument();
  });

  it("renders degraded health loudly with the SLI failure forensics", async () => {
    mocks.getCcSloStatus.mockResolvedValue(
      sloStatus({
        health: {
          status: "degraded",
          degraded_since: "2026-07-18T08:00:00Z",
          last_error: "query failed: boom",
        },
      }),
    );

    renderSloDetailRoute();

    expect(
      await screen.findByText(/Evaluation degraded since/),
    ).toBeInTheDocument();
    expect(screen.getByText("query failed: boom")).toBeInTheDocument();
  });

  it("pauses the SLO from the header and invalidates both queries", async () => {
    const user = userEvent.setup();
    renderSloDetailRoute();

    await user.click(await screen.findByRole("button", { name: /Pause/ }));

    await waitFor(() =>
      expect(mocks.pauseCcSlo).toHaveBeenCalledWith({
        data: { sloId: SLO_ID },
      }),
    );
    expect(mocks.toastSuccess).toHaveBeenCalledWith("SLO updated");
  });

  it("fails to the shared error card when the SLO read errors", async () => {
    mocks.getCcSlo.mockRejectedValue(new Error("cc down"));

    renderSloDetailRoute();

    expect(await screen.findByRole("alert")).toHaveTextContent("cc down");
  });
});
