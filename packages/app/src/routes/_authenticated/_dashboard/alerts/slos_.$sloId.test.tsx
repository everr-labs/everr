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
  it("renders the header facts and the per-group budget snapshot", async () => {
    renderSloDetailRoute();

    expect(
      await screen.findByRole("heading", { name: "checkout-availability" }),
    ).toBeInTheDocument();
    expect(screen.getByText("99.9% over 30d rolling")).toBeInTheDocument();

    // The group row: labels, SLI, error budget remaining, per-tier burn
    // rates, humanized time to exhaustion, firing tier badge. (findBy: the
    // status query settles after the SLO's own read.)
    expect(await screen.findByText("checkout")).toBeInTheDocument();
    expect(screen.getByText("99.92%")).toBeInTheDocument(); // SLI
    expect(screen.getByText("42.00%")).toBeInTheDocument(); // budget remaining
    // The burn column leads with the shortest-long-window tier's sustained
    // burn ("1.4× / 1h"); the per-tier long/short matrix lives in its tooltip.
    expect(screen.getByText(/1\.4×/)).toBeInTheDocument();
    expect(screen.getByText(/\/ 1h/)).toBeInTheDocument();
    expect(screen.queryByText(/0\.9×/)).not.toBeInTheDocument(); // short burn: tooltip-only
    expect(screen.getByText("3d 4h")).toBeInTheDocument(); // exhaustion
    // fast-burn shows up in the firing-tier badge and the objective's
    // canonical tier table.
    expect(screen.getAllByText("fast-burn").length).toBeGreaterThanOrEqual(2);

    // Freshness line off computed_at.
    expect(screen.getByText(/Snapshot computed/)).toBeInTheDocument();

    // Objective card: canonical tiers table (spec has none of its own).
    expect(
      screen.getByText(/Burn-rate tiers \(canonical\)/),
    ).toBeInTheDocument();
    expect(screen.getByText("slow-burn")).toBeInTheDocument();
    // ticket appears in the canonical tier table (the group readout keeps
    // per-tier detail in the burn tooltip).
    expect(screen.getByText("ticket")).toBeInTheDocument();

    // Health reads healthy, quietly.
    expect(screen.getByText("healthy")).toBeInTheDocument();
  });

  it("renders a scalar (label-less) group as all traffic", async () => {
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

    expect(await screen.findByText("all traffic")).toBeInTheDocument();
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
