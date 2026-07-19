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
import type { CcSlo } from "@/data/cc/types";
import { Route as SlosFileRoute } from "./slos";

// ---------------------------------------------------------------------------
// Mocks at the module boundary the route talks to, same as ./rules.test.tsx.
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({
  listCcSlos: vi.fn(),
  getCcSloStatus: vi.fn(),
  pauseCcSlo: vi.fn(),
  resumeCcSlo: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("@/data/cc/server", () => ({
  listCcSlos: mocks.listCcSlos,
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

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

function renderSlosRoute() {
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
  const slosRoute = createRoute({
    getParentRoute: () => dashboardRoute,
    path: "alerts/slos",
    component: SlosFileRoute.options.component,
  });
  // Link target (per-SLO detail); never rendered here.
  const sloDetailRoute = createRoute({
    getParentRoute: () => dashboardRoute,
    path: "alerts/slos/$sloId",
    component: () => null,
  });

  const routeTree = rootRoute.addChildren([
    authenticatedRoute.addChildren([
      dashboardRoute.addChildren([slosRoute, sloDetailRoute]),
    ]),
  ]);

  const history = createMemoryHistory({ initialEntries: ["/alerts/slos"] });
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
  mocks.listCcSlos.mockResolvedValue([ccSlo()]);
  // The listing joins each SLO with its latest evaluator snapshot.
  mocks.getCcSloStatus.mockResolvedValue({
    computed_at: new Date().toISOString(),
    health: { status: "healthy", degraded_since: null, last_error: null },
    payload: {
      window: "30d",
      target_percent: 99.9,
      window_computed_at: {},
      groups: [
        {
          labels: { service: "checkout" },
          sli: 0.9995,
          budget_remaining: 0.5,
          tiers: [
            {
              name: "fast-burn",
              long_burn_rate: 0.5,
              short_burn_rate: 0.4,
              long_window_valid: true,
            },
          ],
          time_to_exhaustion_secs: 86_400,
          firing_tiers: [],
        },
      ],
    },
  });
  mocks.pauseCcSlo.mockResolvedValue(ccSlo({ paused: true }));
  mocks.resumeCcSlo.mockResolvedValue(ccSlo());
});

describe("/alerts/slos route", () => {
  it("leads each row with status: budget, burn, exhaustion — config as the secondary line", async () => {
    renderSlosRoute();

    const link = await screen.findByRole("link", {
      name: "checkout-availability",
    });
    expect(link).toHaveAttribute("href", `/alerts/slos/${SLO_ID}`);
    const table = screen.getByRole("table");
    // Config compressed into one secondary line under the name.
    expect(
      within(table).getByText(/99\.9% over 30d rolling/),
    ).toBeInTheDocument();
    expect(within(table).getByText("service")).toBeInTheDocument();
    // The evaluator snapshot renders as budget meter, burn headline (the
    // shortest-long-window canonical tier: fast-burn over 1h), and time to
    // exhaustion.
    expect(await within(table).findByText("50.00%")).toBeInTheDocument();
    expect(within(table).getAllByText(/0\.5×/).length).toBeGreaterThan(0);
    expect(within(table).getAllByText(/\/ 1h/).length).toBeGreaterThan(0);
    expect(within(table).getByText("1d")).toBeInTheDocument();
    expect(within(table).getByText("active")).toBeInTheDocument();
  });

  it("marks a paused SLO and flags a suppressed one", async () => {
    mocks.listCcSlos.mockResolvedValue([
      ccSlo({
        paused: true,
        spec: { ...ccSlo().spec, suppressed: true },
      }),
    ]);

    renderSlosRoute();

    expect(await screen.findByText("paused")).toBeInTheDocument();
    expect(screen.getByText("suppressed")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Resume/ })).toBeInTheDocument();
  });

  it("pauses an active SLO and invalidates the listing", async () => {
    const user = userEvent.setup();
    renderSlosRoute();

    await user.click(await screen.findByRole("button", { name: /Pause/ }));

    await waitFor(() =>
      expect(mocks.pauseCcSlo).toHaveBeenCalledWith({
        data: { sloId: SLO_ID },
      }),
    );
    expect(mocks.toastSuccess).toHaveBeenCalledWith("SLO updated");
  });

  it("offers no delete action — SLOs are removed as code, not from the UI", async () => {
    renderSlosRoute();

    await screen.findByRole("link", { name: "checkout-availability" });
    expect(
      screen.queryByRole("button", { name: /Delete/ }),
    ).not.toBeInTheDocument();
  });

  it("shows the empty state when no SLOs are defined", async () => {
    mocks.listCcSlos.mockResolvedValue([]);

    renderSlosRoute();

    expect(await screen.findByText("No SLOs defined")).toBeInTheDocument();
  });

  it("fails to the shared error card when the listing errors", async () => {
    mocks.listCcSlos.mockRejectedValue(new Error("cc down"));

    renderSlosRoute();

    expect(await screen.findByRole("alert")).toHaveTextContent("cc down");
  });
});
