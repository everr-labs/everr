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
import type { AlertEventLogRow } from "@/data/alerts/history.server";
import { ccRuleViewFixture } from "@/data/cc/test-fixtures";
import type {
  CcAlert,
  CcReceiver,
  CcRoute,
  CcRuleView,
  CcSilence,
  CcSlo,
} from "@/data/cc/types";
import { Route as AlertsIndexFileRoute } from "./index";

const mocks = vi.hoisted(() => ({
  listCcAlerts: vi.fn(),
  listCcRules: vi.fn(),
  listCcSlos: vi.fn(),
  getCcSloStatus: vi.fn(),
  getCcSloBudgetNow: vi.fn(),
  listCcRoutes: vi.fn(),
  listCcReceivers: vi.fn(),
  listCcSilences: vi.fn(),
  listCcSubscriptions: vi.fn(),
  listCcEventHistory: vi.fn(),
  createCcSilence: vi.fn(),
}));

vi.mock("@/data/cc/server", () => ({
  listCcAlerts: mocks.listCcAlerts,
  listCcRules: mocks.listCcRules,
  listCcSlos: mocks.listCcSlos,
  getCcSloStatus: mocks.getCcSloStatus,
  getCcSloBudgetNow: mocks.getCcSloBudgetNow,
  listCcRoutes: mocks.listCcRoutes,
  listCcReceivers: mocks.listCcReceivers,
  listCcSilences: mocks.listCcSilences,
  listCcSubscriptions: mocks.listCcSubscriptions,
  listCcEventHistory: mocks.listCcEventHistory,
  createCcSilence: mocks.createCcSilence,
}));

function ccRule(overrides: Partial<CcRuleView> = {}): CcRuleView {
  return ccRuleViewFixture({
    id: "rule-1",
    spec: {
      interval_secs: 30,
      label_columns: ["host"],
      value_column: null,
      annotations: {
        "everr.display.name": "Flapping check",
        "everr.display.description": "Fires when the flap condition holds.",
        "everr.runbook": "demo/flap-runbook",
      },
    },
    ...overrides,
  });
}

function ccAlert(overrides: Partial<CcAlert> = {}): CcAlert {
  return {
    key: "fp-1",
    rule: "rule-1",
    tenant: "org1",
    status: "firing",
    labels: { host: "web-1" },
    value: 42,
    active_since: new Date(Date.now() - 300_000).toISOString(),
    last_seen: new Date().toISOString(),
    absent_count: 0,
    ...overrides,
  };
}

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

function sloAlert(overrides: Partial<CcAlert> = {}): CcAlert {
  return ccAlert({
    key: "fp-slo-1",
    rule: SLO_ID,
    slo: SLO_ID,
    labels: { service: "checkout", slo_tier: "fast-burn" },
    value: 14.6,
    ...overrides,
  });
}

function ccRoute(overrides: Partial<CcRoute> = {}): CcRoute {
  return {
    id: "route-1",
    tenant: "org1",
    matchers: [{ label: "host", op: "eq", value: "web-1" }],
    receiver: "oncall",
    continue: false,
    priority: 1,
    group_by: null,
    group_wait_secs: null,
    group_interval_secs: null,
    repeat_interval_secs: null,
    ...overrides,
  };
}

function ccReceiver(overrides: Partial<CcReceiver> = {}): CcReceiver {
  return {
    id: "recv-1",
    tenant: "org1",
    name: "oncall",
    channels: ["team-slack", "pd"],
    ...overrides,
  };
}

function ccSilence(overrides: Partial<CcSilence> = {}): CcSilence {
  return {
    id: "sil-1",
    tenant: "org1",
    matchers: [{ label: "svc", op: "eq", value: "api" }],
    starts_at: new Date(Date.now() - 3_600_000).toISOString(),
    ends_at: new Date(Date.now() + 3_600_000).toISOString(),
    comment: "maintenance",
    author: null,
    created_at: new Date(Date.now() - 3_600_000).toISOString(),
    ...overrides,
  };
}

function eventRow(overrides: Partial<AlertEventLogRow> = {}): AlertEventLogRow {
  return {
    timestamp: new Date(Date.now() - 60_000).toISOString(),
    eventType: "instance_fired",
    slug: "flapping",
    instanceFingerprint: "fp-1",
    labels: { host: "web-1" },
    severity: "critical",
    suppressed: false,
    silenced: false,
    deliveryTargets: [],
    evidence: { status_code: 500 },
    evidenceTruncated: false,
    ...overrides,
  };
}

/** Seed routed, pending, silenced, and inactive instances. */
function seedBoard() {
  mocks.listCcRules.mockResolvedValue([
    ccRule(),
    ccRule({
      id: "rule-2",
      name: "default/api-errors",
      spec: {
        ...ccRule().spec,
        severity: "warning",
        annotations: {},
      },
      health: {
        status: "degraded",
        consecutive_failures: 3,
        degraded_since: new Date().toISOString(),
        last_error: "boom",
        last_error_at: new Date().toISOString(),
      },
    }),
  ]);
  mocks.listCcAlerts.mockResolvedValue([
    ccAlert(),
    ccAlert({
      key: "fp-2",
      status: "pending",
      labels: { host: "web-2" },
      value: null,
    }),
    ccAlert({
      key: "fp-3",
      rule: "rule-2",
      labels: { svc: "api" },
      value: 7,
    }),
    ccAlert({ key: "fp-4", status: "inactive", labels: { host: "web-9" } }),
  ]);
  mocks.listCcSlos.mockResolvedValue([]);
  mocks.listCcRoutes.mockResolvedValue([ccRoute()]);
  mocks.listCcReceivers.mockResolvedValue([ccReceiver()]);
  mocks.listCcSilences.mockResolvedValue([ccSilence()]);
  mocks.listCcSubscriptions.mockResolvedValue([]);
  mocks.listCcEventHistory.mockResolvedValue([eventRow()]);
}

function renderTriagePage() {
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
  const triageRoute = createRoute({
    getParentRoute: () => alertsLayoutRoute,
    path: "/",
    component: AlertsIndexFileRoute.options.component,
  });

  const routeTree = rootRoute.addChildren([
    authenticatedRoute.addChildren([
      dashboardRoute.addChildren([
        alertsLayoutRoute.addChildren([triageRoute]),
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

async function expandRowByLabel(
  user: ReturnType<typeof userEvent.setup>,
  text: string,
) {
  await user.click(await screen.findByText(text));
}

beforeEach(() => {
  for (const fn of Object.values(mocks)) fn.mockReset();
  mocks.getCcSloStatus.mockResolvedValue(null);
  // No fresh scan result by default: surfaces fall back to the snapshot.
  mocks.getCcSloBudgetNow.mockResolvedValue([]);
  mocks.createCcSilence.mockResolvedValue(ccSilence({ id: "sil-new" }));
  seedBoard();
});

describe("/alerts triage board", () => {
  it("counts the whole pipeline but boards only what is firing", async () => {
    renderTriagePage();

    const strip = await screen.findByRole("region", {
      name: "Alerting pipeline",
    });
    expect(strip).toHaveTextContent("2 rules · 0 SLOs");
    expect(strip).toHaveTextContent("1 active silence");
    // The strip is a readout: the counts by state live here, and nothing on it
    // is clickable.
    expect(within(strip).queryAllByRole("button")).toHaveLength(0);
    expect(within(strip).queryAllByRole("link")).toHaveLength(0);

    // The board is triage, not inventory: pending and inactive instances are
    // counted by the strip but not listed.
    const board = screen.getByRole("region", { name: "Triage board" });
    expect(within(board).getByText("Flapping check")).toBeInTheDocument();
    expect(within(board).getByText("api-errors")).toBeInTheDocument();
    expect(within(board).getByText("web-1")).toBeInTheDocument();
    expect(within(board).getByText("api")).toBeInTheDocument();
    expect(within(board).queryByText("web-2")).toBeNull();
    expect(within(board).queryByText("web-9")).toBeNull();
    // Every row names its state and duration together ("firing 12h"): the
    // age cell is self-describing on a card that mixes rules and SLOs.
    expect(within(board).getAllByTitle(/^firing since /)).toHaveLength(2);
    expect(within(board).getByText("silenced")).toBeInTheDocument();
  });

  it("names each row's controls after the row, not 'instance'", async () => {
    renderTriagePage();
    const board = await screen.findByRole("region", { name: "Triage board" });

    // Several rows means several expanders; naming them all "Expand instance"
    // would make them indistinguishable to anyone listening rather than
    // looking.
    expect(
      await within(board).findByRole("button", { name: "Expand host=web-1" }),
    ).toBeInTheDocument();
    expect(
      within(board).getByRole("button", { name: "Expand svc=api" }),
    ).toBeInTheDocument();
    expect(
      within(board).getByRole("button", {
        name: "Silence everything under Flapping check",
      }),
    ).toBeInTheDocument();
    // The count that used to sit in the group header is gone: every row is
    // drawn right below it, so the number only restated the screen.
    expect(within(board).queryByText(/^\d+ instances?$/)).toBeNull();
  });

  it("resolves the delivery fact through routes and marks the unrouted ones", async () => {
    renderTriagePage();

    expect(await screen.findByText("oncall")).toBeInTheDocument();
    // The receiver is the visible fact; its channels stay on the tooltip.
    expect(screen.queryByText(/team-slack, pd/)).toBeNull();
    expect(screen.getByTitle(/team-slack, pd/)).toBeInTheDocument();
    // Only host=web-1 matches the single route; the one other firing row
    // (svc=api) says it reaches no one.
    expect(screen.getAllByText("not routed · no subscribers")).toHaveLength(1);
  });

  it("overflows a long receiver list as +N instead of truncating names", async () => {
    mocks.listCcRoutes.mockResolvedValue([
      ccRoute({ id: "route-1", receiver: "oncall", continue: true }),
      ccRoute({
        id: "route-2",
        receiver: "backup",
        continue: true,
        priority: 2,
      }),
      ccRoute({ id: "route-3", receiver: "mgmt", priority: 3 }),
    ]);
    mocks.listCcReceivers.mockResolvedValue([
      ccReceiver(),
      ccReceiver({ id: "recv-2", name: "backup", channels: ["mail"] }),
      ccReceiver({ id: "recv-3", name: "mgmt", channels: ["mail"] }),
    ]);
    renderTriagePage();

    // Two names shown, the rest counted; the full list stays on the tooltip.
    expect(await screen.findByText("oncall, backup +1")).toBeInTheDocument();
    expect(screen.getByTitle(/oncall, backup, mgmt/)).toBeInTheDocument();
  });

  it("warns when every matched receiver has no channels", async () => {
    mocks.listCcReceivers.mockResolvedValue([ccReceiver({ channels: [] })]);
    renderTriagePage();

    // Routed to a receiver that fans out to nothing delivers exactly nothing:
    // it gets the "not routed" warning treatment, not a healthy arrow.
    const dead = await screen.findByRole("link", {
      name: /oncall · no channels/,
    });
    expect(dead).toBeInTheDocument();
  });

  it("marks unrouted instances as firehose only when subscriptions exist", async () => {
    mocks.listCcSubscriptions.mockResolvedValue([
      {
        id: "sub-1",
        tenant: "org1",
        webhook_url: "https://example.test/hook",
        created_at: new Date().toISOString(),
      },
    ]);

    renderTriagePage();

    expect(
      await screen.findAllByText("not routed · firehose only"),
    ).toHaveLength(1);
  });

  it("expands a row into its evidence, runbook, and fingerprint-scoped feed", async () => {
    const user = userEvent.setup();
    renderTriagePage();

    await expandRowByLabel(user, "web-1");

    expect(await screen.findByText("status_code=500")).toBeInTheDocument();
    expect(
      screen.getByText("Fires when the flap condition holds."),
    ).toBeInTheDocument();
    // Two runbook paths on purpose: the row's shortcut icon and the
    // expanded detail's full-width action.
    expect(screen.getAllByRole("link", { name: /Runbook/ })).not.toHaveLength(
      0,
    );

    // The page reads a single stored event, only to date-stamp the all-clear
    // readout; each expanded row fetches its own, narrowed server-side by
    // fingerprint. Nothing else on the page asks ClickHouse for events.
    const calls = mocks.listCcEventHistory.mock.calls.map(
      (c) => (c[0] as { data: Record<string, unknown> }).data,
    );
    expect(calls).toContainEqual(expect.objectContaining({ limit: 1 }));
    expect(calls).toContainEqual(
      expect.objectContaining({ fingerprint: "fp-1" }),
    );
    expect(
      calls.every((c) => c.limit === 1 || c.fingerprint !== undefined),
    ).toBe(true);
  });

  it("renders SLO-sourced instances under the SLO's name and links to its detail page", async () => {
    mocks.listCcSlos.mockResolvedValue([ccSlo()]);
    mocks.listCcAlerts.mockResolvedValue([ccAlert(), sloAlert()]);

    renderTriagePage();

    const sloLink = await screen.findAllByRole("link", {
      name: "checkout-availability",
    });
    expect(sloLink[0]).toHaveAttribute(
      "href",
      "/alerts/slos/default/checkout-availability",
    );
    // Tier names are detail, not triage: no per-tier badge on the row (the
    // severity badge and burn rate carry the urgency).
    expect(screen.queryByText("fast-burn")).toBeNull();
    expect(screen.getByText("checkout")).toBeInTheDocument();
    expect(screen.getAllByText("critical").length).toBeGreaterThanOrEqual(1);
  });

  it("falls back to the short source id, unlinked, when a listing has not caught up", async () => {
    // Either listing can lag a newly created source, and a short id is no
    // address to route to.
    const unknownRuleId = "unknown-rule-id";
    mocks.listCcAlerts.mockResolvedValue([
      sloAlert(),
      ccAlert({ rule: unknownRuleId }),
    ]);

    renderTriagePage();

    await screen.findByText(SLO_ID.slice(0, 8));
    expect(
      screen.queryByRole("link", { name: SLO_ID.slice(0, 8) }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("SLO")).toBeInTheDocument();
    expect(screen.getByText(unknownRuleId.slice(0, 8))).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: unknownRuleId.slice(0, 8) }),
    ).not.toBeInTheDocument();
  });

  const silenceCases: {
    source: string;
    seed: () => void;
    row: string;
    matchers: { label: string; op: string; value: string }[];
  }[] = [
    {
      source: "rule-sourced",
      seed: seedBoard,
      row: "web-1",
      matchers: [
        { label: "host", op: "eq", value: "web-1" },
        { label: "rule", op: "eq", value: "rule-1" },
      ],
    },
    {
      source: "SLO-sourced",
      seed: () => {
        mocks.listCcSlos.mockResolvedValue([ccSlo()]);
        mocks.listCcAlerts.mockResolvedValue([sloAlert()]);
      },
      row: "checkout",
      // No slo_tier: the row is this label set across every tier, so muting it
      // mutes all of them rather than handing the page to the next tier down.
      matchers: [
        { label: "service", op: "eq", value: "checkout" },
        { label: "slo", op: "eq", value: SLO_ID },
      ],
    },
  ];

  it.each(
    silenceCases,
  )("silences a $source row for the chosen window, scoped to its source", async ({
    seed,
    row,
    matchers,
  }) => {
    seed();
    const user = userEvent.setup();
    renderTriagePage();

    await expandRowByLabel(user, row);
    await user.click(screen.getByRole("button", { name: "1h" }));

    expect(mocks.createCcSilence).toHaveBeenCalledTimes(1);
    const { data } = mocks.createCcSilence.mock.calls[0][0] as {
      data: {
        matchers: { label: string; op: string; value: string }[];
        starts_at: string;
        ends_at: string;
      };
    };
    expect(data.matchers).toEqual(matchers);
    expect(
      new Date(data.ends_at).getTime() - new Date(data.starts_at).getTime(),
    ).toBe(3_600_000);
  });

  it("shows the row's own error budget, not the SLO's worst group", async () => {
    mocks.listCcSlos.mockResolvedValue([ccSlo()]);
    mocks.listCcAlerts.mockResolvedValue([sloAlert()]);
    mocks.getCcSloStatus.mockResolvedValue({
      payload: {
        groups: [
          // A different label set is deeper in the red; the checkout row must
          // still print its own number.
          { labels: { service: "search" }, budget_remaining: -0.2 },
          { labels: { service: "checkout" }, budget_remaining: 0.581 },
        ],
      },
    });

    renderTriagePage();

    expect(await screen.findByText("58.10%")).toBeInTheDocument();
    // The worst group's number belongs to the exhausted-budgets card below,
    // never to this row.
    const board = screen.getByRole("region", { name: "Triage board" });
    expect(within(board).queryByText("-20.00%")).toBeNull();
    expect(screen.getByText("Exhausted error budgets")).toBeInTheDocument();
  });

  it("boards an exhausted budget even when nothing is firing", async () => {
    mocks.listCcAlerts.mockResolvedValue([]);
    mocks.listCcSilences.mockResolvedValue([]);
    mocks.listCcSlos.mockResolvedValue([ccSlo()]);
    mocks.getCcSloStatus.mockResolvedValue({
      payload: {
        groups: [{ labels: { service: "checkout" }, budget_remaining: -0.024 }],
      },
    });

    renderTriagePage();

    // The all-clear and the damage report coexist: nothing is firing, and yet
    // a budget is spent.
    expect(await screen.findByText("All clear")).toBeInTheDocument();
    expect(
      await screen.findByText("Exhausted error budgets"),
    ).toBeInTheDocument();
    expect(screen.getByText("-2.40%")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /checkout-availability/ }),
    ).toHaveAttribute("href", "/alerts/slos/default/checkout-availability");
  });

  it("keeps an exhausted budget on its board while the SLO also fires", async () => {
    // The two boards answer different questions: the fire is on triage, the
    // spent budget stays on the damage report.
    mocks.listCcSlos.mockResolvedValue([ccSlo()]);
    mocks.listCcAlerts.mockResolvedValue([sloAlert()]);
    mocks.getCcSloStatus.mockResolvedValue({
      payload: {
        groups: [{ labels: { service: "checkout" }, budget_remaining: -0.024 }],
      },
    });

    renderTriagePage();

    expect(
      await screen.findByText("Exhausted error budgets"),
    ).toBeInTheDocument();
    const board = screen.getByRole("region", { name: "Triage board" });
    expect(within(board).getByText("checkout")).toBeInTheDocument();
    // One link on the triage row, one on the exhausted-budgets row.
    expect(
      screen.getAllByRole("link", { name: /checkout-availability/ }),
    ).toHaveLength(2);
  });

  it("overlays the read-time budget on the snapshot's, like the SLO pages", async () => {
    mocks.listCcSlos.mockResolvedValue([ccSlo()]);
    mocks.listCcAlerts.mockResolvedValue([sloAlert()]);
    // The engine's throttled snapshot says 58%; the read-time scan says 25%.
    mocks.getCcSloStatus.mockResolvedValue({
      payload: {
        groups: [
          {
            labels: { service: "checkout" },
            budget_remaining: 0.581,
            tiers: [],
          },
        ],
      },
    });
    mocks.getCcSloBudgetNow.mockResolvedValue([
      { labels: { service: "checkout" }, sli: 0.999, budgetRemaining: 0.25 },
    ]);

    renderTriagePage();

    expect(await screen.findByText("25.00%")).toBeInTheDocument();
    expect(screen.queryByText("58.10%")).toBeNull();
    // The scan is bounded to displayed SLOs: exactly this one.
    expect(mocks.getCcSloBudgetNow).toHaveBeenCalledTimes(1);
  });

  it("drops a snapshot-exhausted budget the fresh scan says has recovered", async () => {
    mocks.listCcAlerts.mockResolvedValue([]);
    mocks.listCcSilences.mockResolvedValue([]);
    mocks.listCcSlos.mockResolvedValue([ccSlo()]);
    mocks.getCcSloStatus.mockResolvedValue({
      payload: {
        groups: [
          {
            labels: { service: "checkout" },
            budget_remaining: -0.024,
            tiers: [],
          },
        ],
      },
    });
    mocks.getCcSloBudgetNow.mockResolvedValue([
      { labels: { service: "checkout" }, sli: 0.9995, budgetRemaining: 0.1 },
    ]);

    renderTriagePage();

    expect(await screen.findByText("All clear")).toBeInTheDocument();
    // Membership follows the freshened numbers: once the read-time scan
    // lands, no damage board for a budget that has already recovered. (The
    // snapshot legitimately shows the card until then.)
    await waitFor(() =>
      expect(screen.queryByText("Exhausted error budgets")).toBeNull(),
    );
  });

  it("hides the exhausted-budgets board when every budget holds", async () => {
    mocks.listCcSlos.mockResolvedValue([ccSlo()]);
    mocks.listCcAlerts.mockResolvedValue([sloAlert()]);
    mocks.getCcSloStatus.mockResolvedValue({
      payload: {
        groups: [{ labels: { service: "checkout" }, budget_remaining: 0.4 }],
      },
    });

    renderTriagePage();

    await screen.findAllByRole("link", { name: "checkout-availability" });
    expect(screen.queryByText("Exhausted error budgets")).toBeNull();
  });

  it("shows the all-clear instrument when nothing is firing", async () => {
    mocks.listCcAlerts.mockResolvedValue([]);
    mocks.listCcSilences.mockResolvedValue([]);

    renderTriagePage();

    expect(await screen.findByText("All clear")).toBeInTheDocument();
    expect(screen.getByText(/2 rules watching/)).toBeInTheDocument();
    expect(screen.getByText(/last event/)).toBeInTheDocument();
  });

  it("fails the whole page rather than rendering a false all-clear", async () => {
    mocks.listCcAlerts.mockRejectedValue(new Error("fetch failed"));

    renderTriagePage();

    expect(
      await screen.findByText("Alerting service unavailable"),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("region", { name: "Triage board" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("region", { name: "Alerting pipeline" }),
    ).not.toBeInTheDocument();
  });

  it("says the event read failed rather than claiming no events", async () => {
    mocks.listCcAlerts.mockResolvedValue([]);
    mocks.listCcSilences.mockResolvedValue([]);
    // The events read only date-stamps the readout, so losing it must not cost
    // the all-clear itself — but "no events in 24h" would be a claim we cannot
    // make, and on an all-clear card that reads as corroboration.
    mocks.listCcEventHistory.mockRejectedValue(new Error("clickhouse down"));

    renderTriagePage();

    expect(await screen.findByText("All clear")).toBeInTheDocument();
    expect(screen.getByText(/event history unavailable/)).toBeInTheDocument();
    expect(screen.queryByText(/no events in the last 24h/)).toBeNull();
  });
});
