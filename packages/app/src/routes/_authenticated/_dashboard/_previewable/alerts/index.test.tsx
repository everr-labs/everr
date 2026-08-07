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
import { alertingRuleViewFixture } from "@/data/alerting/test-fixtures";
import type {
  AlertingAlert,
  AlertingReceiver,
  AlertingRoute,
  AlertingRuleView,
  AlertingSilence,
  AlertingSlo,
  AlertingSloStatusPayload,
} from "@/data/alerting/types";
import type { AlertEventLogRow } from "@/data/alerts/history.server";
import { Route as AlertsIndexFileRoute } from "./index";

const mocks = vi.hoisted(() => ({
  listAlertingAlerts: vi.fn(),
  listAlertingRules: vi.fn(),
  listAlertingSlos: vi.fn(),
  getAlertingSloStatus: vi.fn(),
  getAlertingSloBudgetNow: vi.fn(),
  listAlertingRoutes: vi.fn(),
  listAlertingReceivers: vi.fn(),
  listAlertingSilences: vi.fn(),
  listAlertingEventHistory: vi.fn(),
  createAlertingSilence: vi.fn(),
  deleteAlertingSilence: vi.fn(),
  toastSuccess: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: {
    success: mocks.toastSuccess,
  },
}));

vi.mock("@/data/alerting/server", () => ({
  listAlertingAlerts: mocks.listAlertingAlerts,
  listAlertingRules: mocks.listAlertingRules,
  listAlertingSlos: mocks.listAlertingSlos,
  getAlertingSloStatus: mocks.getAlertingSloStatus,
  getAlertingSloBudgetNow: mocks.getAlertingSloBudgetNow,
  listAlertingRoutes: mocks.listAlertingRoutes,
  listAlertingReceivers: mocks.listAlertingReceivers,
  listAlertingSilences: mocks.listAlertingSilences,
  listAlertingEventHistory: mocks.listAlertingEventHistory,
  createAlertingSilence: mocks.createAlertingSilence,
  deleteAlertingSilence: mocks.deleteAlertingSilence,
}));

function alertingRule(
  overrides: Partial<AlertingRuleView> = {},
): AlertingRuleView {
  return alertingRuleViewFixture({
    id: "rule-1",
    spec: {
      interval_secs: 30,
      label_columns: ["host"],
      condition: { operator: "gt", threshold: 0 },
      annotations: {
        "everr.display.name": "Flapping check",
        "everr.display.description": "Fires when the flap condition holds.",
        "everr.runbook": "demo/flap-runbook",
      },
    },
    ...overrides,
  });
}

function alertingAlert(overrides: Partial<AlertingAlert> = {}): AlertingAlert {
  return {
    key: "rule-1:fp-1",
    fingerprint: "fp-1",
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

function alertingSlo(overrides: Partial<AlertingSlo> = {}): AlertingSlo {
  const name = overrides.name ?? "default/checkout-availability";
  return {
    id: SLO_ID,
    tenant: "org1",
    repoid: "repo-1",
    previewId: null,
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
    name: name.includes("/") ? name : `default/${name}`,
  };
}

function sloAlert(overrides: Partial<AlertingAlert> = {}): AlertingAlert {
  return alertingAlert({
    key: `${SLO_ID}:fast-burn`,
    fingerprint: "fast-burn",
    rule: SLO_ID,
    slo: SLO_ID,
    labels: { slo_tier: "fast-burn" },
    value: 14.6,
    ...overrides,
  });
}

function sloPayload(
  budget_remaining: number | null,
  overrides: Partial<AlertingSloStatusPayload> = {},
): AlertingSloStatusPayload {
  return {
    window: "30d",
    target_percent: 99.9,
    sli: null,
    budget_remaining,
    tiers: [],
    time_to_exhaustion_secs: null,
    firing_tiers: [],
    window_computed_at: {},
    ...overrides,
  };
}

function alertingRoute(overrides: Partial<AlertingRoute> = {}): AlertingRoute {
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

function alertingReceiver(
  overrides: Partial<AlertingReceiver> = {},
): AlertingReceiver {
  return {
    id: "recv-1",
    tenant: "org1",
    name: "oncall",
    channels: ["team-slack", "pd"],
    ...overrides,
  };
}

function alertingSilence(
  overrides: Partial<AlertingSilence> = {},
): AlertingSilence {
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
    inhibited: false,
    deliveryTargets: [],
    evidence: { status_code: 500 },
    evidenceTruncated: false,
    ...overrides,
  };
}

/** Seed routed, pending, silenced, and inactive instances. */
function seedBoard() {
  mocks.listAlertingRules.mockResolvedValue([
    alertingRule(),
    alertingRule({
      id: "rule-2",
      name: "default/api-errors",
      spec: {
        ...alertingRule().spec,
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
  mocks.listAlertingAlerts.mockResolvedValue([
    alertingAlert(),
    alertingAlert({
      key: "fp-2",
      status: "pending",
      labels: { host: "web-2" },
      value: null,
    }),
    alertingAlert({
      key: "fp-3",
      rule: "rule-2",
      labels: { svc: "api" },
      value: 7,
    }),
    alertingAlert({
      key: "fp-4",
      status: "inactive",
      labels: { host: "web-9" },
    }),
  ]);
  mocks.listAlertingSlos.mockResolvedValue([]);
  mocks.listAlertingRoutes.mockResolvedValue([alertingRoute()]);
  mocks.listAlertingReceivers.mockResolvedValue([alertingReceiver()]);
  mocks.listAlertingSilences.mockResolvedValue([alertingSilence()]);
  mocks.listAlertingEventHistory.mockResolvedValue([eventRow()]);
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
  mocks.getAlertingSloStatus.mockResolvedValue(null);
  // No fresh scan result by default: surfaces fall back to the snapshot.
  mocks.getAlertingSloBudgetNow.mockResolvedValue(null);
  mocks.createAlertingSilence.mockResolvedValue(
    alertingSilence({ id: "sil-new" }),
  );
  mocks.deleteAlertingSilence.mockResolvedValue({ deleted: true });
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
    expect(within(strip).queryAllByRole("button")).toHaveLength(0);
    expect(
      within(strip).getByRole("link", { name: "2 rules" }),
    ).toHaveAttribute("href", "/alerts/rules");
    expect(within(strip).getByRole("link", { name: "0 SLOs" })).toHaveAttribute(
      "href",
      "/alerts/slos",
    );

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
    const user = userEvent.setup();
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
        name: "Silence Flapping check",
      }),
    ).toBeInTheDocument();
    expect(
      within(board).getByRole("button", {
        name: "Quick silence Flapping check",
      }),
    ).toBeInTheDocument();
    expect(within(board).queryByText(/^\d+ instances?$/)).toBeNull();

    await user.click(
      within(board).getByRole("button", { name: "Silence Flapping check" }),
    );
    expect(
      await screen.findByRole("heading", { name: "New silence" }),
    ).toBeInTheDocument();
  });

  it("resolves delivery through routes without flagging a silenced row", async () => {
    renderTriagePage();

    await screen.findByTitle(/team-slack, pd/);
    // Only host=web-1 matches the route. The other firing row is intentionally
    // silenced, so it is not presented as a delivery failure.
    expect(screen.queryByText("Not delivered")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("overflows a long receiver list as +N instead of truncating names", async () => {
    mocks.listAlertingRoutes.mockResolvedValue([
      alertingRoute({ id: "route-1", receiver: "oncall", continue: true }),
      alertingRoute({
        id: "route-2",
        receiver: "backup",
        continue: true,
        priority: 2,
      }),
      alertingRoute({ id: "route-3", receiver: "mgmt", priority: 3 }),
    ]);
    mocks.listAlertingReceivers.mockResolvedValue([
      alertingReceiver(),
      alertingReceiver({ id: "recv-2", name: "backup", channels: ["mail"] }),
      alertingReceiver({ id: "recv-3", name: "mgmt", channels: ["mail"] }),
    ]);
    renderTriagePage();

    // Two names shown, the rest counted; the full list stays on the tooltip.
    expect(await screen.findByText("oncall, backup +1")).toBeInTheDocument();
    expect(screen.getByTitle(/oncall, backup, mgmt/)).toBeInTheDocument();
  });

  it("warns when every matched receiver has no channels", async () => {
    mocks.listAlertingReceivers.mockResolvedValue([
      alertingReceiver({ channels: [] }),
    ]);
    renderTriagePage();

    // Routed to a receiver that fans out to nothing delivers exactly nothing:
    // it gets the "not routed" warning treatment, not a healthy arrow.
    await screen.findByRole("link", { name: "No destination" });
  });

  it("marks unrouted instances as not delivered when no routes exist", async () => {
    mocks.listAlertingRoutes.mockResolvedValue([]);

    renderTriagePage();

    await screen.findByText("Not delivered");
    const warning = screen.getByRole("alert");
    expect(warning).toHaveTextContent("1 firing alert is not being delivered");
    expect(
      within(warning).getByRole("link", { name: "Configure delivery" }),
    ).toBeInTheDocument();
  });

  it("expands a row into its evidence, runbook, and instance-scoped feed", async () => {
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
    expect(screen.queryByRole("link", { name: "View logs" })).toBeNull();

    // The page reads a single stored event, only to date-stamp the all-clear
    // readout; each expanded row fetches its own, narrowed server-side by
    // instance and source. Nothing else on the page asks for event history.
    const calls = mocks.listAlertingEventHistory.mock.calls.map(
      (c) => (c[0] as { data: Record<string, unknown> }).data,
    );
    expect(calls).toContainEqual(expect.objectContaining({ limit: 1 }));
    expect(calls).toContainEqual(
      expect.objectContaining({
        fingerprint: "fp-1",
        sourceId: "rule-1",
      }),
    );
    expect(
      calls.every((c) => c.limit === 1 || c.fingerprint !== undefined),
    ).toBe(true);
  });

  it("distinguishes unavailable instance history from no state changes", async () => {
    const user = userEvent.setup();
    mocks.listAlertingEventHistory
      .mockResolvedValueOnce([eventRow()])
      .mockRejectedValueOnce(new Error("postgres unavailable"));

    renderTriagePage();
    await expandRowByLabel(user, "web-1");

    expect(
      await screen.findByText("State history unavailable."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/No state changes/)).toBeNull();
  });

  it("renders SLO-sourced instances under the SLO's name and links to its detail page", async () => {
    mocks.listAlertingSlos.mockResolvedValue([alertingSlo()]);
    mocks.listAlertingAlerts.mockResolvedValue([alertingAlert(), sloAlert()]);

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
    expect(screen.getAllByText("critical").length).toBeGreaterThanOrEqual(1);
  });

  it("falls back to the short source id, unlinked, when a listing has not caught up", async () => {
    // Either listing can lag a newly created source, and a short id is no
    // address to route to.
    const unknownRuleId = "unknown-rule-id";
    mocks.listAlertingAlerts.mockResolvedValue([
      sloAlert(),
      alertingAlert({ rule: unknownRuleId }),
    ]);

    renderTriagePage();

    await screen.findByText(SLO_ID.slice(0, 8));
    expect(
      screen.queryByRole("link", { name: SLO_ID.slice(0, 8) }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("SLO", { selector: "span" })).toBeInTheDocument();
    expect(screen.getByText(unknownRuleId.slice(0, 8))).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: unknownRuleId.slice(0, 8) }),
    ).not.toBeInTheDocument();
  });

  const silenceCases: {
    source: string;
    seed: () => void;
    quickName: string;
    matchers: { label: string; op: string; value: string }[];
  }[] = [
    {
      source: "rule-sourced",
      seed: seedBoard,
      quickName: "Quick silence Flapping check",
      matchers: [{ label: "rule", op: "eq", value: "rule-1" }],
    },
    {
      source: "SLO-sourced",
      seed: () => {
        mocks.listAlertingSlos.mockResolvedValue([alertingSlo()]);
        mocks.listAlertingAlerts.mockResolvedValue([sloAlert()]);
      },
      quickName: "Quick silence checkout-availability",
      // No slo_tier: muting the SLO covers every burn-rate tier.
      matchers: [{ label: "slo", op: "eq", value: SLO_ID }],
    },
  ];

  it.each(
    silenceCases,
  )("silences a $source row for the chosen window, scoped to its source", async ({
    seed,
    quickName,
    matchers,
  }) => {
    seed();
    const user = userEvent.setup();
    renderTriagePage();

    await user.click(await screen.findByRole("button", { name: quickName }));
    await user.click(await screen.findByRole("menuitem", { name: "1 hour" }));

    expect(mocks.createAlertingSilence).toHaveBeenCalledTimes(1);
    const { data } = mocks.createAlertingSilence.mock.calls[0][0] as {
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

    mocks.toastSuccess.mock.calls.at(-1)?.[1]?.action?.onClick();
    await waitFor(() =>
      expect(mocks.deleteAlertingSilence).toHaveBeenCalledWith({
        data: { id: "sil-new" },
      }),
    );
  });

  it("shows the SLO's error budget on its firing row", async () => {
    mocks.listAlertingSlos.mockResolvedValue([alertingSlo()]);
    mocks.listAlertingAlerts.mockResolvedValue([sloAlert()]);
    mocks.getAlertingSloStatus.mockResolvedValue({
      payload: sloPayload(0.581),
    });

    renderTriagePage();

    expect(await screen.findByText("58.10%")).toBeInTheDocument();
    expect(screen.queryByText("Exhausted error budgets")).toBeNull();
  });

  it("boards an exhausted budget even when nothing is firing", async () => {
    mocks.listAlertingAlerts.mockResolvedValue([]);
    mocks.listAlertingSilences.mockResolvedValue([]);
    mocks.listAlertingSlos.mockResolvedValue([alertingSlo()]);
    mocks.getAlertingSloStatus.mockResolvedValue({
      payload: sloPayload(-0.024),
    });

    renderTriagePage();

    // The all-clear and the damage report coexist: nothing is firing, and yet
    // a budget is spent.
    expect(await screen.findByText("All clear")).toBeInTheDocument();
    expect(
      await screen.findByText("Exhausted error budgets"),
    ).toBeInTheDocument();
    expect(screen.getByText("Exhausted")).toHaveAttribute(
      "title",
      "-2.40% remaining",
    );
    expect(
      screen.getByRole("link", { name: /checkout-availability/ }),
    ).toHaveAttribute("href", "/alerts/slos/default/checkout-availability");
  });

  it("does not duplicate an exhausted SLO that is already firing", async () => {
    mocks.listAlertingSlos.mockResolvedValue([alertingSlo()]);
    mocks.listAlertingAlerts.mockResolvedValue([sloAlert()]);
    mocks.getAlertingSloStatus.mockResolvedValue({
      payload: sloPayload(-0.024),
    });

    renderTriagePage();

    expect(
      await screen.findAllByRole("link", { name: /checkout-availability/ }),
    ).toHaveLength(1);
  });

  it("overlays the read-time budget on the snapshot's, like the SLO pages", async () => {
    mocks.listAlertingSlos.mockResolvedValue([alertingSlo()]);
    mocks.listAlertingAlerts.mockResolvedValue([sloAlert()]);
    // The stored snapshot says 58%; the read-time scan says 25%.
    mocks.getAlertingSloStatus.mockResolvedValue({
      payload: sloPayload(0.581),
    });
    mocks.getAlertingSloBudgetNow.mockResolvedValue({
      sli: 0.999,
      budgetRemaining: 0.25,
    });

    renderTriagePage();

    expect(await screen.findByText("25.00%")).toBeInTheDocument();
    expect(screen.queryByText("58.10%")).toBeNull();
    // The scan is bounded to displayed SLOs: exactly this one.
    expect(mocks.getAlertingSloBudgetNow).toHaveBeenCalledTimes(1);
  });

  it("drops a snapshot-exhausted budget the fresh scan says has recovered", async () => {
    mocks.listAlertingAlerts.mockResolvedValue([]);
    mocks.listAlertingSilences.mockResolvedValue([]);
    mocks.listAlertingSlos.mockResolvedValue([alertingSlo()]);
    mocks.getAlertingSloStatus.mockResolvedValue({
      payload: sloPayload(-0.024),
    });
    mocks.getAlertingSloBudgetNow.mockResolvedValue({
      sli: 0.9995,
      budgetRemaining: 0.1,
    });

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
    mocks.listAlertingSlos.mockResolvedValue([alertingSlo()]);
    mocks.listAlertingAlerts.mockResolvedValue([sloAlert()]);
    mocks.getAlertingSloStatus.mockResolvedValue({
      payload: sloPayload(0.4),
    });

    renderTriagePage();

    await screen.findAllByRole("link", { name: "checkout-availability" });
    expect(screen.queryByText("Exhausted error budgets")).toBeNull();
  });

  it("shows the all-clear instrument when nothing is firing", async () => {
    mocks.listAlertingAlerts.mockResolvedValue([]);
    mocks.listAlertingSilences.mockResolvedValue([]);

    renderTriagePage();

    expect(await screen.findByText("All clear")).toBeInTheDocument();
    expect(screen.getByText(/2 rules watching/)).toBeInTheDocument();
    expect(screen.getByText(/last event/)).toBeInTheDocument();
  });

  it("fails the whole page rather than rendering a false all-clear", async () => {
    mocks.listAlertingAlerts.mockRejectedValue(new Error("fetch failed"));

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
    mocks.listAlertingAlerts.mockResolvedValue([]);
    mocks.listAlertingSilences.mockResolvedValue([]);
    // The events read only date-stamps the readout, so losing it must not cost
    // the all-clear itself — but "no events in 24h" would be a claim we cannot
    // make, and on an all-clear card that reads as corroboration.
    mocks.listAlertingEventHistory.mockRejectedValue(
      new Error("clickhouse down"),
    );

    renderTriagePage();

    expect(await screen.findByText("All clear")).toBeInTheDocument();
    expect(screen.getByText(/event history unavailable/)).toBeInTheDocument();
    expect(screen.queryByText(/no events in the last 24h/)).toBeNull();
  });
});
