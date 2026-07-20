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
  pauseCcSlo: vi.fn(),
  resumeCcSlo: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  feedProps: vi.fn(),
}));

vi.mock("@/data/cc/server", () => ({
  getCcSlo: mocks.getCcSlo,
  getCcSloStatus: mocks.getCcSloStatus,
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

    // The objective reads as a sentence before any numbers.
    expect(
      await screen.findByText(
        /Promises 99\.9% of valid events are good over a 30d rolling window, tracked per service\./,
      ),
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
    // fast-burn appears in the pressure gauge and the objective's tier table.
    expect(screen.getAllByText("fast-burn").length).toBeGreaterThanOrEqual(2);

    // Freshness line off computed_at.
    expect(screen.getByText(/Snapshot computed/)).toBeInTheDocument();

    // Objective card: canonical tiers table (spec has none of its own).
    expect(
      screen.getByText(/Burn-rate tiers \(canonical\)/),
    ).toBeInTheDocument();
    // slow-burn / ticket now appear in both the pressure gauges and the
    // objective tier table.
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

    // Scalar summary: no "tracked per" clause.
    expect(
      await screen.findByText(
        /Promises 99\.9% of valid events are good over a 30d rolling window\./,
      ),
    ).toBeInTheDocument();
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
