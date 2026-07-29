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
  const sloDetailRoute = createRoute({
    getParentRoute: () => dashboardRoute,
    path: "alerts/slos/$project/$slug",
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
  mocks.getCcSloBudgetNow.mockResolvedValue([]);
  mocks.pauseCcSlo.mockResolvedValue(ccSlo({ paused: true }));
  mocks.resumeCcSlo.mockResolvedValue(ccSlo());
});

describe("/alerts/slos route", () => {
  it("names a row by its display name, linked to its address and its runbook", async () => {
    mocks.listCcSlos.mockResolvedValue([
      ccSlo({
        spec: {
          ...ccSlo().spec,
          annotations: {
            "everr.display.name": "Checkout Availability",
            "everr.runbook": "platform/log-pipeline",
          },
        },
      }),
    ]);

    renderSlosRoute();

    const table = await screen.findByRole("table");
    expect(
      within(table).getByRole("link", { name: "Checkout Availability" }),
    ).toHaveAttribute("href", "/alerts/slos/default/checkout-availability");
    expect(
      within(table).getByRole("link", {
        name: "Open runbook for Checkout Availability",
      }),
    ).toHaveAttribute("href", "/runbooks/platform/log-pipeline");
  });

  it("pauses an active SLO only after the confirmation is accepted", async () => {
    const user = userEvent.setup();
    renderSlosRoute();

    const table = await screen.findByRole("table");
    await user.click(within(table).getByRole("button", { name: /Pause/ }));
    const cancelled = await screen.findByRole("alertdialog");
    await user.click(within(cancelled).getByRole("button", { name: "Cancel" }));
    expect(mocks.pauseCcSlo).not.toHaveBeenCalled();

    await user.click(within(table).getByRole("button", { name: /Pause/ }));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "Pause SLO" }));

    await waitFor(() =>
      expect(mocks.pauseCcSlo).toHaveBeenCalledWith({
        data: { sloId: SLO_ID },
      }),
    );
    expect(mocks.toastSuccess).toHaveBeenCalledWith("SLO updated");
  });

  it("resumes a paused SLO", async () => {
    mocks.listCcSlos.mockResolvedValue([ccSlo({ paused: true })]);
    const user = userEvent.setup();
    renderSlosRoute();

    const table = await screen.findByRole("table");
    await user.click(within(table).getByRole("button", { name: /Resume/ }));

    await waitFor(() =>
      expect(mocks.resumeCcSlo).toHaveBeenCalledWith({
        data: { sloId: SLO_ID },
      }),
    );
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
    expect(await within(table).findByText("10.00%")).toBeInTheDocument();
  });

  it("reports the worst group severity and budget, not a total", async () => {
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

    expect(await within(table).findByText("Critical")).toBeInTheDocument();
    expect(within(table).getByText("1h")).toBeInTheDocument();
    expect(within(table).getByText("2.00%")).toBeInTheDocument();
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

    expect(await screen.findByText(/1-10 of 12/)).toBeInTheDocument();
    const table = await screen.findByRole("table");
    expect(
      within(table).getByRole("link", { name: "svc-00" }),
    ).toBeInTheDocument();
    expect(
      within(table).queryByRole("link", { name: "svc-10" }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Next/ }));

    expect(await screen.findByText(/11-12 of 12/)).toBeInTheDocument();
    expect(
      within(table).getByRole("link", { name: "svc-10" }),
    ).toBeInTheDocument();
    expect(
      within(table).queryByRole("link", { name: "svc-00" }),
    ).not.toBeInTheDocument();
  });
});
