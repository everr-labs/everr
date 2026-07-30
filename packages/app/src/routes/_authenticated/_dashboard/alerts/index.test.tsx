import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AlertEventLogRow } from "@/data/alerts/history.server";
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
  listCcRoutes: mocks.listCcRoutes,
  listCcReceivers: mocks.listCcReceivers,
  listCcSilences: mocks.listCcSilences,
  listCcSubscriptions: mocks.listCcSubscriptions,
  listCcEventHistory: mocks.listCcEventHistory,
  createCcSilence: mocks.createCcSilence,
}));

function ccRule(overrides: Partial<CcRuleView> = {}): CcRuleView {
  return {
    id: "rule-1",
    tenant: "org1",
    namespace: "",
    name: "default/flapping",
    spec: {
      sql: "SELECT 1",
      interval_secs: 30,
      for_secs: 0,
      label_columns: ["host"],
      value_column: null,
      severity: "critical",
      annotations: {
        "everr.display.name": "Flapping check",
        "everr.display.description": "Fires when the flap condition holds.",
        "everr.runbook": "demo/flap-runbook",
      },
      resolve_after: 1,
      suppressed: false,
    },
    version: 1,
    paused: false,
    updated_at: "2026-06-14T12:00:00Z",
    health: {
      status: "healthy",
      consecutive_failures: 0,
      degraded_since: null,
      last_error: null,
      last_error_at: null,
    },
    ...overrides,
  };
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

async function cardOf(headingText: string): Promise<HTMLElement> {
  const heading = await screen.findByRole("heading", { name: headingText });
  const card = heading.closest('[data-slot="card"]');
  if (card === null) throw new Error(`no card ancestor for "${headingText}"`);
  return card as HTMLElement;
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
  mocks.createCcSilence.mockResolvedValue(ccSilence({ id: "sil-new" }));
  seedBoard();
});

describe("/alerts triage board", () => {
  it("counts the board and partitions instances across the three lenses", async () => {
    const user = userEvent.setup();
    renderTriagePage();

    const strip = await screen.findByRole("region", {
      name: "Alerting pipeline",
    });
    expect(strip).toHaveTextContent("2 rules · 0 SLOs");
    expect(strip).toHaveTextContent("1 active silence");
    // The strip is a readout; the lens control below it is what filters.
    expect(within(strip).queryAllByRole("button")).toHaveLength(0);
    expect(within(strip).queryAllByRole("link")).toHaveLength(0);

    // Firing: unsilenced firing and pending rows, never silenced or inactive.
    const firing = screen.getByRole("region", { name: "Alert instances" });
    expect(within(firing).getByText("Flapping check")).toBeInTheDocument();
    expect(within(firing).getByText("web-1")).toBeInTheDocument();
    expect(within(firing).getByText("pending")).toBeInTheDocument();
    expect(within(firing).getByText("web-2")).toBeInTheDocument();
    expect(within(firing).queryByText("api")).not.toBeInTheDocument();
    expect(within(firing).queryByText("web-9")).not.toBeInTheDocument();

    // A string `name` matches the full accessible name, so this is the
    // segmented control's button, not the strip cell (whose name also carries
    // its counts).
    await user.click(screen.getByRole("button", { name: "Silenced" }));
    const silenced = screen.getByRole("region", { name: "Alert instances" });
    expect(within(silenced).getByText("api")).toBeInTheDocument();
    expect(within(silenced).getByText("api-errors")).toBeInTheDocument();
    expect(within(silenced).queryByText("web-1")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "All" }));
    const all = screen.getByRole("region", { name: "Alert instances" });
    expect(within(all).getByText("web-9")).toBeInTheDocument();
    expect(within(all).getByText("web-1")).toBeInTheDocument();
    expect(within(all).getByText("api")).toBeInTheDocument();
  });

  it("resolves the delivery fact through routes and marks the unrouted ones", async () => {
    renderTriagePage();

    expect(await screen.findByText("oncall")).toBeInTheDocument();
    expect(screen.getByText(/team-slack, pd/)).toBeInTheDocument();
    expect(screen.getByText("not routed · no subscribers")).toBeInTheDocument();
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
      await screen.findByText("not routed · firehose only"),
    ).toBeInTheDocument();
  });

  it("expands a row into its evidence, runbook, and fingerprint-scoped feed", async () => {
    const user = userEvent.setup();
    renderTriagePage();

    await expandRowByLabel(user, "web-1");

    expect(await screen.findByText("status_code=500")).toBeInTheDocument();
    expect(
      screen.getByText("Fires when the flap condition holds."),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Runbook/ })).toBeInTheDocument();

    // One page-level events query serves both the recent-events feed and the
    // all-clear freshness line; each expanded row fetches its own events,
    // narrowed server-side by fingerprint.
    const calls = mocks.listCcEventHistory.mock.calls.map(
      (c) => (c[0] as { data: Record<string, unknown> }).data,
    );
    expect(calls).toContainEqual(expect.objectContaining({ limit: 8 }));
    expect(calls).toContainEqual(
      expect.objectContaining({ fingerprint: "fp-1" }),
    );
    expect(
      calls.every((c) => c.limit === 8 || c.fingerprint !== undefined),
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
    expect(screen.getByText("fast-burn")).toBeInTheDocument();
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
      matchers: [
        { label: "service", op: "eq", value: "checkout" },
        { label: "slo_tier", op: "eq", value: "fast-burn" },
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
      screen.queryByRole("region", { name: "Alert instances" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("region", { name: "Alerting pipeline" }),
    ).not.toBeInTheDocument();
  });
});

describe("/alerts recent events", () => {
  it("shows an error (not a false 'no events') when the history query fails", async () => {
    mocks.listCcEventHistory.mockRejectedValue(new Error("clickhouse down"));

    renderTriagePage();

    const recent = await cardOf("Recent events");
    expect(
      await within(recent).findByText(/Event history unavailable/),
    ).toBeInTheDocument();
    expect(
      within(recent).queryByText(/No stored events/),
    ).not.toBeInTheDocument();
  });
});
