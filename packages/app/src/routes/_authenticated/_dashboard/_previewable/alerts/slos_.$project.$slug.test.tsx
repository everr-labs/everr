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
import type { AlertingSlo, AlertingSloStatus } from "@/data/alerting/types";
import { Route as SloDetailFileRoute } from "./slos_.$project.$slug";

const mocks = vi.hoisted(() => ({
  getAlertingSloByName: vi.fn(),
  getAlertingSloStatus: vi.fn(),
  getAlertingSloBudgetSeries: vi.fn(),
  getAlertingSloBudgetNow: vi.fn(),
  pauseAlertingSlo: vi.fn(),
  resumeAlertingSlo: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("@/data/alerting/server", () => ({
  getAlertingSloByName: mocks.getAlertingSloByName,
  getAlertingSloStatus: mocks.getAlertingSloStatus,
  getAlertingSloBudgetSeries: mocks.getAlertingSloBudgetSeries,
  getAlertingSloBudgetNow: mocks.getAlertingSloBudgetNow,
  pauseAlertingSlo: mocks.pauseAlertingSlo,
  resumeAlertingSlo: mocks.resumeAlertingSlo,
}));

vi.mock("sonner", () => ({
  toast: {
    success: (...a: unknown[]) => mocks.toastSuccess(...a),
    error: (...a: unknown[]) => mocks.toastError(...a),
  },
}));

const SLO_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const PROJECT = "default";
const SLUG = "checkout-availability";

function alertingSlo(overrides: Partial<AlertingSlo> = {}): AlertingSlo {
  return {
    id: SLO_ID,
    tenant: "org1",
    repoid: "repo-1",
    previewId: null,
    name: `${PROJECT}/${SLUG}`,
    spec: {
      sli: {
        sql: "SELECT countIf(ok) AS good, count() AS valid FROM t WHERE ts >= {window_start:DateTime} AND ts < {window_end:DateTime}",
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

function sloStatus(
  overrides: Partial<AlertingSloStatus> = {},
): AlertingSloStatus {
  return {
    computed_at: new Date(Date.now() - 60_000).toISOString(),
    payload: {
      window: "30d",
      target_percent: 99.9,
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
      window_computed_at: { "300s": 1752829200 },
    },
    health: { status: "healthy", degraded_since: null, last_error: null },
    ...overrides,
  };
}

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
    path: "alerts/slos/$project/$slug",
    component: SloDetailFileRoute.options.component,
  });
  const slosRoute = createRoute({
    getParentRoute: () => dashboardRoute,
    path: "alerts/slos",
    component: () => null,
  });
  const runbookRoute = createRoute({
    getParentRoute: () => dashboardRoute,
    path: "runbooks/$project/$slug",
    component: () => null,
  });

  const routeTree = rootRoute.addChildren([
    authenticatedRoute.addChildren([
      dashboardRoute.addChildren([sloDetailRoute, slosRoute, runbookRoute]),
    ]),
  ]);

  const history = createMemoryHistory({
    initialEntries: [`/alerts/slos/${PROJECT}/${SLUG}`],
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
  mocks.getAlertingSloByName.mockResolvedValue(alertingSlo());
  mocks.getAlertingSloStatus.mockResolvedValue(sloStatus());
  mocks.getAlertingSloBudgetSeries.mockResolvedValue([]);
  mocks.getAlertingSloBudgetNow.mockResolvedValue(null);
  mocks.pauseAlertingSlo.mockResolvedValue(alertingSlo({ paused: true }));
  mocks.resumeAlertingSlo.mockResolvedValue(alertingSlo());
});

describe("/alerts/slos/$project/$slug route", () => {
  it("reports the SLO's current calculations, charting them over its own window", async () => {
    renderSloDetailRoute();

    const summary = await screen.findByRole("region", {
      name: "SLO activity summary",
    });
    expect(within(summary).getByText("Error budget left")).toBeInTheDocument();
    expect(within(summary).getByText("Time to exhaustion")).toBeInTheDocument();
    expect(await screen.findByText("over 30d rolling")).toBeInTheDocument();
    expect(screen.getAllByText("99.9%").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("99.92%")).toBeInTheDocument();
    expect(screen.getByText("42.00%")).toBeInTheDocument();
    expect(screen.getByText("3d 4h")).toBeInTheDocument();
    expect(screen.getByText(/1\.4×/)).toBeInTheDocument();

    await waitFor(() =>
      expect(mocks.getAlertingSloBudgetSeries).toHaveBeenCalled(),
    );
    const arg = mocks.getAlertingSloBudgetSeries.mock.calls.at(-1)?.[0] as {
      data: { sloId: string };
    };
    expect(arg.data.sloId).toBe(SLO_ID);
  });

  it("shows the display name as the heading, with the description and runbook alongside", async () => {
    mocks.getAlertingSloByName.mockResolvedValue(
      alertingSlo({
        spec: {
          ...alertingSlo().spec,
          annotations: {
            "everr.display.name": "Checkout Availability",
            "everr.display.description": "Can shoppers complete checkout?",
            "everr.runbook": "demo/checkout-runbook",
          },
        },
      }),
    );

    renderSloDetailRoute();

    expect(
      await screen.findByRole("heading", { name: "Checkout Availability" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Can shoppers complete checkout?"),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Runbook/ })).toHaveAttribute(
      "href",
      "/runbooks/demo/checkout-runbook",
    );
  });

  it("overrides the snapshot's budget with the read-time value in the strip", async () => {
    mocks.getAlertingSloBudgetNow.mockResolvedValue({
      sli: 0.998,
      budgetRemaining: 0.1,
    });
    renderSloDetailRoute();

    expect(await screen.findByText("10.00%")).toBeInTheDocument();
    // Uses the effective burn rate, min(1.4, 0.9), for the forecast.
    expect(screen.getByText("3d 8h")).toBeInTheDocument();
  });

  it("shows the pending state when no snapshot exists yet", async () => {
    mocks.getAlertingSloStatus.mockResolvedValue(null);

    renderSloDetailRoute();

    expect(
      await screen.findByText("No status snapshot yet"),
    ).toBeInTheDocument();
  });

  it("announces a degraded evaluator", async () => {
    mocks.getAlertingSloStatus.mockResolvedValue(
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
      await screen.findByLabelText("Evaluation degraded"),
    ).toBeInTheDocument();
  });

  it("pauses the SLO from the header once the confirmation is accepted", async () => {
    const user = userEvent.setup();
    renderSloDetailRoute();

    await user.click(await screen.findByRole("button", { name: /Pause/ }));

    const dialog = await screen.findByRole("alertdialog");
    expect(mocks.pauseAlertingSlo).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole("button", { name: "Pause SLO" }));

    await waitFor(() =>
      expect(mocks.pauseAlertingSlo).toHaveBeenCalledWith({
        data: { sloId: SLO_ID },
      }),
    );
    expect(mocks.toastSuccess).toHaveBeenCalledWith("SLO updated");
  });

  it("fails to the shared error card when the SLO read errors", async () => {
    mocks.getAlertingSloByName.mockRejectedValue(
      new Error("alerting unavailable"),
    );

    renderSloDetailRoute();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "alerting unavailable",
    );
  });
});
