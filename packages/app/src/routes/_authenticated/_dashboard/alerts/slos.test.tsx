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
  getCcSloBudgetNow: vi.fn(),
  pauseCcSlo: vi.fn(),
  resumeCcSlo: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("@/data/cc/server", () => ({
  listCcSlos: mocks.listCcSlos,
  getCcSloStatus: mocks.getCcSloStatus,
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

function renderSlosRoute(initialEntry = "/alerts/slos") {
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

  const history = createMemoryHistory({ initialEntries: [initialEntry] });
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
  // No read-time budget by default: the row falls back to the snapshot.
  mocks.getCcSloBudgetNow.mockResolvedValue([]);
  mocks.pauseCcSlo.mockResolvedValue(ccSlo({ paused: true }));
  mocks.resumeCcSlo.mockResolvedValue(ccSlo());
});

describe("/alerts/slos route", () => {
  it("leads each row with status: budget, burn, exhaustion — config as the secondary line", async () => {
    renderSlosRoute();

    const table = await screen.findByRole("table");
    const link = within(table).getByRole("link", {
      name: "checkout-availability",
    });
    expect(link).toHaveAttribute("href", `/alerts/slos/${SLO_ID}`);
    // Config compressed into one secondary line under the name.
    expect(
      within(table).getByText(/99\.9% over 30d rolling/),
    ).toBeInTheDocument();
    expect(within(table).getByText("service")).toBeInTheDocument();
    // The evaluator snapshot renders as budget meter, a plain-language burn pace
    // (0.5× is under the sustainable line -> "Sustainable") with the multiplier
    // as support, and time to exhaustion.
    expect(await within(table).findByText("50.00%")).toBeInTheDocument();
    expect(within(table).getByText("On track")).toBeInTheDocument();
    expect(within(table).getByText("Sustainable")).toBeInTheDocument();
    expect(within(table).getAllByText(/0\.5×/).length).toBeGreaterThan(0);
    expect(within(table).getByText("1d to empty")).toBeInTheDocument();
    expect(
      within(table).getByRole("button", { name: /Pause/ }),
    ).toBeInTheDocument();
  });

  it("marks a paused SLO and flags a suppressed one", async () => {
    mocks.listCcSlos.mockResolvedValue([
      ccSlo({
        paused: true,
        spec: { ...ccSlo().spec, suppressed: true },
      }),
    ]);

    renderSlosRoute();

    expect((await screen.findAllByText("paused")).length).toBeGreaterThan(0);
    expect(screen.getAllByText("suppressed").length).toBeGreaterThan(0);
    expect(
      screen.getAllByRole("button", { name: /Resume/ }).length,
    ).toBeGreaterThan(0);
  });

  it("pauses an active SLO and invalidates the listing", async () => {
    const user = userEvent.setup();
    renderSlosRoute();

    const table = await screen.findByRole("table");
    await user.click(within(table).getByRole("button", { name: /Pause/ }));

    await waitFor(() =>
      expect(mocks.pauseCcSlo).toHaveBeenCalledWith({
        data: { sloId: SLO_ID },
      }),
    );
    expect(mocks.toastSuccess).toHaveBeenCalledWith("SLO updated");
  });

  it("offers no delete action — SLOs are removed as code, not from the UI", async () => {
    renderSlosRoute();

    const table = await screen.findByRole("table");
    expect(
      within(table).getByRole("link", { name: "checkout-availability" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Delete/ }),
    ).not.toBeInTheDocument();
  });

  it("shows the empty state when no SLOs are defined", async () => {
    mocks.listCcSlos.mockResolvedValue([]);

    renderSlosRoute();

    expect(await screen.findByText("No SLOs defined")).toBeInTheDocument();
  });

  it("passes the active preview name into the SLO listing query", async () => {
    renderSlosRoute("/alerts/slos?preview=feat%2Fslo-preview");

    expect(
      (await screen.findAllByRole("link", { name: "checkout-availability" }))
        .length,
    ).toBeGreaterThan(0);
    expect(mocks.listCcSlos).toHaveBeenCalledWith({
      data: { preview: "feat/slo-preview" },
    });
  });

  it("fails to the shared error card when the listing errors", async () => {
    mocks.listCcSlos.mockRejectedValue(new Error("cc down"));

    renderSlosRoute();

    expect(await screen.findByRole("alert")).toHaveTextContent("cc down");
  });

  it("overrides a row's budget with the read-time value as of page view", async () => {
    mocks.getCcSloBudgetNow.mockResolvedValue([
      { labels: { service: "checkout" }, sli: 0.99, budgetRemaining: 0.1 },
    ]);
    renderSlosRoute();

    const table = await screen.findByRole("table");
    // The fresh 10%, not the snapshot's 50%.
    expect(await within(table).findByText("10.00%")).toBeInTheDocument();
    expect(within(table).queryByText("50.00%")).not.toBeInTheDocument();
  });

  it("folds burn, exhaustion, and firing tiers into the Now column", async () => {
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
            sli: 0.9,
            budget_remaining: 0.02, // worst, and firing
            tiers: [
              {
                name: "fast-burn",
                long_burn_rate: 20,
                short_burn_rate: 18,
                long_window_valid: 1,
              },
            ],
            time_to_exhaustion_secs: 3600,
            firing_tiers: [{ tier: "fast-burn", status: "firing" }],
          },
          {
            labels: { service: "cart" },
            sli: 0.95,
            budget_remaining: 0.1, // at risk (<25%)
            tiers: [],
            time_to_exhaustion_secs: null,
            firing_tiers: [],
          },
          {
            labels: { service: "search" },
            sli: 0.999,
            budget_remaining: 0.9, // healthy
            tiers: [],
            time_to_exhaustion_secs: null,
            firing_tiers: [],
          },
        ],
      },
    });

    renderSlosRoute();
    const table = await screen.findByRole("table");

    // No standalone Burn or Firing columns; the pace word carries severity and
    // the tier badge is folded in beside it.
    expect(
      within(table).queryByRole("columnheader", { name: "Burn" }),
    ).not.toBeInTheDocument();
    expect(
      within(table).queryByRole("columnheader", { name: "Firing" }),
    ).not.toBeInTheDocument();
    expect(await within(table).findByText("Burning fast")).toBeInTheDocument();
    expect(within(table).getByText("fast-burn")).toBeInTheDocument();

    // The worst group is the 2% one; the row also flags the rest of the fleet.
    expect(within(table).getByText("2.00%")).toBeInTheDocument();
    expect(within(table).getByText(/worst of 3 groups/)).toBeInTheDocument();
    expect(within(table).getByText(/1 firing/)).toBeInTheDocument();
    expect(within(table).getByText(/1 at risk/)).toBeInTheDocument();
  });

  it("shows a firing alert window without calling stopped current burn burning", async () => {
    mocks.getCcSloStatus.mockResolvedValue({
      computed_at: new Date().toISOString(),
      health: { status: "healthy", degraded_since: null, last_error: null },
      payload: {
        window: "30d",
        target_percent: 99.9,
        window_computed_at: {},
        groups: [
          {
            labels: { service: "payments" },
            sli: 0.98,
            budget_remaining: 0.3,
            tiers: [
              {
                name: "fast-burn",
                long_burn_rate: 4,
                short_burn_rate: 0,
                long_window_valid: 1,
              },
              {
                name: "ticket",
                long_burn_rate: 2,
                short_burn_rate: 1.5,
                long_window_valid: 1,
              },
            ],
            time_to_exhaustion_secs: null,
            firing_tiers: [{ tier: "ticket", status: "firing" }],
          },
        ],
      },
    });

    renderSlosRoute();
    const table = await screen.findByRole("table");

    expect(within(table).getByText("Alert firing")).toBeInTheDocument();
    expect(
      within(table).getByText("ticket firing on earlier burn (2.0×)"),
    ).toBeInTheDocument();
    expect(within(table).getByText("current burn stopped")).toBeInTheDocument();
    expect(within(table).queryByText("Burning")).not.toBeInTheDocument();
    expect(
      within(table).queryByText("no exhaustion forecast"),
    ).not.toBeInTheDocument();
  });

  it("orders by name, independent of status: a firing SLO does not jump the list", async () => {
    mocks.listCcSlos.mockResolvedValue([
      ccSlo({ id: "z", name: "z-svc" }),
      ccSlo({ id: "a", name: "a-svc" }),
    ]);
    const status = (firing: boolean) => ({
      computed_at: new Date().toISOString(),
      health: { status: "healthy", degraded_since: null, last_error: null },
      payload: {
        window: "30d",
        target_percent: 99.9,
        window_computed_at: {},
        groups: [
          {
            labels: { service: "checkout" },
            sli: 0.99,
            budget_remaining: firing ? 0.05 : 0.9,
            tiers: [
              {
                name: "fast-burn",
                long_burn_rate: 0.5,
                short_burn_rate: 0.4,
                long_window_valid: 1,
              },
            ],
            time_to_exhaustion_secs: 86_400,
            firing_tiers: firing
              ? [{ tier: "fast-burn", status: "firing" }]
              : [],
          },
        ],
      },
    });
    // z-svc is firing and nearly out of budget; a-svc is healthy. Name order
    // still wins: a-svc leads, z-svc stays last.
    mocks.getCcSloStatus.mockImplementation(({ data: { sloId } }) =>
      Promise.resolve(status(sloId === "z")),
    );

    renderSlosRoute();

    const table = await screen.findByRole("table");
    expect(
      within(table).getByRole("link", { name: "a-svc" }),
    ).toBeInTheDocument();
    const names = within(table)
      .getAllByRole("link")
      .map((a) => a.textContent)
      .filter((n) => n?.endsWith("svc"));
    expect(names).toEqual(["a-svc", "z-svc"]);
  });

  it("paginates when there are more SLOs than fit on a page", async () => {
    const many = Array.from({ length: 12 }, (_, i) => {
      const n = i.toString().padStart(2, "0");
      return ccSlo({ id: `slo-${n}`, name: `svc-${n}` });
    });
    mocks.listCcSlos.mockResolvedValue(many);
    const user = userEvent.setup();
    renderSlosRoute();

    // First page: 10 of 12, with a range indicator.
    expect(await screen.findByText(/1-10 of 12/)).toBeInTheDocument();
    const table = await screen.findByRole("table");
    expect(
      within(table).getByRole("link", { name: "svc-00" }),
    ).toBeInTheDocument();
    expect(
      within(table).queryByRole("link", { name: "svc-10" }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Next/ }));

    // Second page: the remaining 2.
    expect(await screen.findByText(/11-12 of 12/)).toBeInTheDocument();
    expect(
      within(table).getByRole("link", { name: "svc-10" }),
    ).toBeInTheDocument();
    expect(
      within(table).queryByRole("link", { name: "svc-00" }),
    ).not.toBeInTheDocument();
  });
});
