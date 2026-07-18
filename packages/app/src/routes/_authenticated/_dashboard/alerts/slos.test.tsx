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
  pauseCcSlo: vi.fn(),
  resumeCcSlo: vi.fn(),
  deleteCcSlo: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("@/data/cc/server", () => ({
  listCcSlos: mocks.listCcSlos,
  pauseCcSlo: mocks.pauseCcSlo,
  resumeCcSlo: mocks.resumeCcSlo,
  deleteCcSlo: mocks.deleteCcSlo,
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
  mocks.pauseCcSlo.mockResolvedValue(ccSlo({ paused: true }));
  mocks.resumeCcSlo.mockResolvedValue(ccSlo());
  mocks.deleteCcSlo.mockResolvedValue({ deleted: true });
});

describe("/alerts/slos route", () => {
  it("renders the SLO's config facts: name link, target, window, groups, tiers, state", async () => {
    renderSlosRoute();

    const link = await screen.findByRole("link", {
      name: "checkout-availability",
    });
    expect(link).toHaveAttribute("href", `/alerts/slos/${SLO_ID}`);
    // Scope to the table: the concept note also mentions "99.9%" as prose.
    const table = screen.getByRole("table");
    expect(within(table).getByText("99.9%")).toBeInTheDocument();
    expect(within(table).getByText("30d rolling")).toBeInTheDocument();
    expect(within(table).getByText("service")).toBeInTheDocument();
    // No explicit tiers -> the canonical trio is what the engine evaluates.
    expect(
      within(table).getByText("fast-burn, slow-burn, ticket"),
    ).toBeInTheDocument();
    expect(within(table).getByText("active")).toBeInTheDocument();
    // The id survives as the muted secondary line.
    expect(within(table).getByText(SLO_ID.slice(0, 8))).toBeInTheDocument();
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

  it("deletes only after the confirm dialog", async () => {
    const user = userEvent.setup();
    renderSlosRoute();

    await user.click(
      await screen.findByRole("button", {
        name: "Delete SLO checkout-availability",
      }),
    );
    // The dialog interposes: nothing deleted yet.
    expect(mocks.deleteCcSlo).not.toHaveBeenCalled();
    expect(
      screen.getByText(/Delete SLO “checkout-availability”\?/),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Delete SLO" }));

    await waitFor(() =>
      expect(mocks.deleteCcSlo).toHaveBeenCalledWith({
        data: { sloId: SLO_ID },
      }),
    );
    expect(mocks.toastSuccess).toHaveBeenCalledWith("SLO deleted");
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
