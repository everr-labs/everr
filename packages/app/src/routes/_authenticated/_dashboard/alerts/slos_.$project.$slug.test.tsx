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
import type { CcSlo, CcSloStatus } from "@/data/cc/types";
import { Route as SloDetailFileRoute } from "./slos_.$project.$slug";

// ---------------------------------------------------------------------------
// Mocks at the module boundary the route talks to, same as the sibling tests.
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({
  getCcSloByName: vi.fn(),
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
  getCcSloByName: mocks.getCcSloByName,
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

// Stubbed so the page's *not* rendering it is an assertion with teeth: a
// regression that re-adds the feed would call this and fail the test.
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
const PROJECT = "default";
const SLUG = "checkout-availability";

function ccSlo(overrides: Partial<CcSlo> = {}): CcSlo {
  return {
    id: SLO_ID,
    tenant: "org1",
    namespace: "",
    name: `${PROJECT}/${SLUG}`,
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
    path: "alerts/slos/$project/$slug",
    component: SloDetailFileRoute.options.component,
  });
  // Back-link target; never rendered here.
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
  mocks.getCcSloByName.mockResolvedValue(ccSlo());
  mocks.getCcSloStatus.mockResolvedValue(sloStatus());
  mocks.getCcSloBudgetSeries.mockResolvedValue([]);
  mocks.getCcSloBudgetNow.mockResolvedValue([]);
  mocks.pauseCcSlo.mockResolvedValue(ccSlo({ paused: true }));
  mocks.resumeCcSlo.mockResolvedValue(ccSlo());
});

describe("/alerts/slos/$project/$slug route", () => {
  it("leads with the stats strip: budget, promise, SLI, burn, and horizon", async () => {
    renderSloDetailRoute();

    // No display name set: the heading falls back to the bare slug, and
    // there is no secondary slug chip (it would just repeat the heading).
    expect(
      await screen.findByRole("heading", { name: SLUG }),
    ).toBeInTheDocument();
    expect(screen.queryByText(`${PROJECT}/${SLUG}`)).not.toBeInTheDocument();
    // The promise leads the stats row (target + window), not the header. The
    // row rides the async status read, so wait for it.
    expect(await screen.findByText("over 30d rolling")).toBeInTheDocument();
    expect(screen.getAllByText("99.9%").length).toBeGreaterThanOrEqual(1);

    // Headline numbers: SLI, budget remaining, burn, time to exhaustion.
    expect(screen.getByText("99.92%")).toBeInTheDocument(); // SLI
    expect(screen.getByText("42.00%")).toBeInTheDocument(); // budget remaining
    expect(screen.getByText("3d 4h")).toBeInTheDocument(); // exhaustion
    expect(screen.getByText(/1\.4×/)).toBeInTheDocument(); // burn (1h)
    expect(screen.getByText("last 1h")).toBeInTheDocument(); // its window

    // The stats strip is the whole status readout now. Nothing restates it: no
    // state pill, no plain-language verdict, no per-tier pressure panel, and
    // no per-tier firing conditions anywhere on the page.
    expect(screen.queryByText("Firing")).not.toBeInTheDocument();
    expect(
      screen.queryByText(/A critical alert is firing/),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Paging: fast-burn")).not.toBeInTheDocument();
    expect(screen.queryByText(/Fires when the last/)).not.toBeInTheDocument();
    expect(screen.queryByText("When it alerts")).not.toBeInTheDocument();
    // A grouped SLI does name its grouping columns (the scalar case below
    // drops the row entirely, so pin the positive case here).
    expect(screen.getByText("SLI groups by")).toBeInTheDocument();
    expect(screen.getByText("service")).toBeInTheDocument();

    // The read-time scan is empty here (no traffic in the trailing window), so the
    // stored snapshot stands and the freshness line reads "computing", not fresh.
    expect(screen.getByText(/Error budget computing/)).toBeInTheDocument();

    // No event feed on this page: the chart's fired and resolved marks are
    // the transitions this page has an opinion about, and the full log lives
    // one link away under Alerts / History.
    expect(mocks.feedProps).not.toHaveBeenCalled();
    expect(screen.queryByText("Alert history")).not.toBeInTheDocument();
    expect(screen.queryByTestId("event-feed")).not.toBeInTheDocument();
  });

  it("shows the display name as the heading, with the description alongside", async () => {
    mocks.getCcSloByName.mockResolvedValue(
      ccSlo({
        spec: {
          ...ccSlo().spec,
          annotations: {
            "everr.display.name": "Checkout Availability",
            "everr.display.description": "Can shoppers complete checkout?",
          },
        },
      }),
    );

    renderSloDetailRoute();

    expect(
      await screen.findByRole("heading", { name: "Checkout Availability" }),
    ).toBeInTheDocument();
    // The heading is the name; the slug is not repeated beside it. It is in
    // the URL, and the breadcrumb and back-link already place the SLO.
    expect(screen.queryByText(SLUG)).not.toBeInTheDocument();
    expect(
      screen.getByText("Can shoppers complete checkout?"),
    ).toBeInTheDocument();
  });

  it("overrides the snapshot's budget with the read-time value in the strip", async () => {
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
    // A non-empty scan landed, so the in-flight note is gone: current numbers
    // do not announce that they are current.
    expect(
      screen.queryByText(/Error budget computing/),
    ).not.toBeInTheDocument();
  });

  it("charts the budget history, scoped to the SLO's budget window", async () => {
    renderSloDetailRoute();

    expect(await screen.findByText("Budget history")).toBeInTheDocument();

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
    // A scalar SLO: no label columns, one label-less group. The stats strip
    // fully describes it, so there is no "All groups" breakdown.
    mocks.getCcSloByName.mockResolvedValue(
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

    // Budget and SLI both read 100% for a perfectly healthy scalar SLO. These
    // ride the async status read, so wait on them rather than on the objective
    // (which renders straight from the SLO and lands first).
    expect(
      (await screen.findAllByText("100.00%")).length,
    ).toBeGreaterThanOrEqual(1);
    // Scalar: nothing groups, so the definition drops the row rather than
    // spending one on "no grouping columns".
    expect(screen.queryByText("SLI groups by")).not.toBeInTheDocument();
    // No multi-group breakdown for a single group.
    expect(screen.queryByText("All groups")).not.toBeInTheDocument();
  });

  it("lists authored annotations only, not the generated ones", async () => {
    mocks.getCcSloByName.mockResolvedValue(
      ccSlo({
        spec: {
          ...ccSlo().spec,
          annotations: {
            "everr.display.name": "Checkout Availability",
            summary: "Checkout is burning budget",
            "link.runbook": "http://everr.test/runbooks/default/checkout",
            team: "payments",
          },
        },
      }),
    );

    renderSloDetailRoute();
    await screen.findByRole("heading", { name: "Checkout Availability" });

    expect(screen.getByText("payments")).toBeInTheDocument();
    // Generated, and each already has its own place: the runbook is the button
    // beside the title, summary is the engine's notification template.
    expect(screen.queryByText(/link.runbook/)).not.toBeInTheDocument();
    expect(screen.queryByText(/everr.test\/runbooks/)).not.toBeInTheDocument();
    expect(screen.queryByText(/summary/)).not.toBeInTheDocument();
  });

  it("shows every group outright once an SLO has more than one", async () => {
    // The stats strip above is the WORST group only, so with several groups
    // the rest of the answer is in this table. It must be readable without a
    // click: a fold would hide exactly the rows the headline is not about.
    mocks.getCcSloStatus.mockResolvedValue(
      sloStatus({
        payload: {
          window: "30d",
          target_percent: 99.9,
          groups: [
            {
              labels: { service: "checkout" },
              sli: 0.9992,
              budget_remaining: 0.42,
              tiers: [],
              time_to_exhaustion_secs: null,
              firing_tiers: [],
            },
            {
              labels: { service: "search" },
              sli: 0.9999,
              budget_remaining: 0.91,
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

    expect(await screen.findByText("All groups")).toBeInTheDocument();
    // Both rows, with no interaction of any kind first.
    expect(screen.getByText("search")).toBeInTheDocument();
    expect(screen.getAllByText("checkout").length).toBeGreaterThanOrEqual(1);
    // And no disclosure to open: the table is not behind one.
    expect(
      screen.queryByRole("button", { name: /All groups/ }),
    ).not.toBeInTheDocument();
  });

  it("shows the pending state when no snapshot exists yet", async () => {
    // getCcSloStatus resolves null for CC's 404: no snapshot row yet.
    mocks.getCcSloStatus.mockResolvedValue(null);

    renderSloDetailRoute();

    expect(
      await screen.findByText("No status snapshot yet"),
    ).toBeInTheDocument();
  });

  it("carries degraded health as a title glyph, not a card of forensics", async () => {
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

    // Awaited, since the glyph rides the status read rather than the SLO.
    expect(
      await screen.findByLabelText("Evaluation degraded"),
    ).toBeInTheDocument();
    // The fact, not the forensics: no Evaluator card, no raw query error.
    expect(screen.queryByText("Evaluator")).not.toBeInTheDocument();
    expect(screen.queryByText("query failed: boom")).not.toBeInTheDocument();
  });

  it("pauses the SLO from the header once the confirmation is accepted", async () => {
    const user = userEvent.setup();
    renderSloDetailRoute();

    await user.click(await screen.findByRole("button", { name: /Pause/ }));

    const dialog = await screen.findByRole("alertdialog");
    expect(mocks.pauseCcSlo).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole("button", { name: "Pause SLO" }));

    await waitFor(() =>
      expect(mocks.pauseCcSlo).toHaveBeenCalledWith({
        data: { sloId: SLO_ID },
      }),
    );
    expect(mocks.toastSuccess).toHaveBeenCalledWith("SLO updated");
  });

  it("fails to the shared error card when the SLO read errors", async () => {
    mocks.getCcSloByName.mockRejectedValue(new Error("cc down"));

    renderSloDetailRoute();

    expect(await screen.findByRole("alert")).toHaveTextContent("cc down");
  });

  it("links the runbook chip when the SLO carries a runbook annotation", async () => {
    mocks.getCcSloByName.mockResolvedValue(
      ccSlo({
        spec: {
          ...ccSlo().spec,
          annotations: { "everr.runbook": "demo/checkout-runbook" },
        },
      }),
    );

    renderSloDetailRoute();

    const runbookLink = await screen.findByRole("link", { name: /Runbook/ });
    expect(runbookLink).toHaveAttribute(
      "href",
      "/runbooks/demo/checkout-runbook",
    );
  });
});
