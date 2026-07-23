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
import { Route as AlertsIndexRoute } from "./index";
import { Route as TriageFileRoute } from "./triage";

// ---------------------------------------------------------------------------
// Mocks, at the same module boundary as ./rules.test.tsx.
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({
  listCcAlerts: vi.fn(),
  listCcRules: vi.fn(),
  listCcSlos: vi.fn(),
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
  listCcRoutes: mocks.listCcRoutes,
  listCcReceivers: mocks.listCcReceivers,
  listCcSilences: mocks.listCcSilences,
  listCcSubscriptions: mocks.listCcSubscriptions,
  listCcEventHistory: mocks.listCcEventHistory,
  createCcSilence: mocks.createCcSilence,
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

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

/** An SLO-sourced burn-rate instance: rule carries the SLO uuid, slo marks it. */
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

/**
 * The default board: one critical rule with a routed firing instance and a
 * pending sibling, one degraded warning rule with a silenced firing instance
 * (its labels match no route), and one inactive instance.
 */
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

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

function renderTriageRoute() {
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
  const triageRoute = createRoute({
    getParentRoute: () => dashboardRoute,
    path: "alerts/triage",
    component: TriageFileRoute.options.component,
  });

  const routeTree = rootRoute.addChildren([
    authenticatedRoute.addChildren([dashboardRoute.addChildren([triageRoute])]),
  ]);

  const history = createMemoryHistory({ initialEntries: ["/alerts/triage"] });
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
  // Full-row click: anywhere that is not a link or button toggles expansion.
  await user.click(await screen.findByText(text));
}

beforeEach(() => {
  for (const fn of Object.values(mocks)) fn.mockReset();
  mocks.createCcSilence.mockResolvedValue(ccSilence({ id: "sil-new" }));
  seedBoard();
});

describe("/alerts index", () => {
  it("is the Overview page, not a redirect (the section leads with the live picture)", () => {
    expect(AlertsIndexRoute.options.beforeLoad).toBeUndefined();
    expect(AlertsIndexRoute.options.component).toBeDefined();
    expect(
      (AlertsIndexRoute.options.staticData as { breadcrumb?: string })
        ?.breadcrumb,
    ).toBe("Overview");
  });
});

describe("/alerts/triage route", () => {
  it("renders the instrument strip counts", async () => {
    renderTriageRoute();

    const strip = await screen.findByRole("region", {
      name: "Alerting status",
    });
    // 2 firing (fp-1 + fp-3), 1 silenced (fp-3), 1 degraded rule, 1 active silence.
    expect(within(strip).getByText("needs attention")).toBeInTheDocument();
    expect(within(strip).getByText("firing").previousSibling).toHaveTextContent(
      "2",
    );
    expect(
      within(strip).getByText("silenced").previousSibling,
    ).toHaveTextContent("1");
    expect(
      within(strip).getByText("degraded rules").previousSibling,
    ).toHaveTextContent("1");
    expect(
      within(strip).getByText("active silences").previousSibling,
    ).toHaveTextContent("1");
  });

  it("hides the degraded-rules cell when no rule is degraded", async () => {
    mocks.listCcRules.mockResolvedValue([ccRule()]);

    renderTriageRoute();

    const strip = await screen.findByRole("region", {
      name: "Alerting status",
    });
    expect(within(strip).queryByText("degraded rules")).not.toBeInTheDocument();
  });

  // Lens assertions scope to the board region: the silences panel below it
  // renders matcher pills that would otherwise collide with instance labels.
  it("Firing lens shows unsilenced firing + pending rows and hides silenced ones", async () => {
    renderTriageRoute();

    // fp-1 (firing) and fp-2 (pending) under the rule's display name.
    expect(await screen.findByText("Flapping check")).toBeInTheDocument();
    const board = screen.getByRole("region", { name: "Alert instances" });
    expect(within(board).getByText("web-1")).toBeInTheDocument();
    expect(within(board).getByText("pending")).toBeInTheDocument();
    expect(within(board).getByText("web-2")).toBeInTheDocument();
    // fp-3 is silenced, fp-4 inactive: neither shows under Firing.
    expect(within(board).queryByText("api")).not.toBeInTheDocument();
    expect(within(board).queryByText("web-9")).not.toBeInTheDocument();
  });

  it("Silenced lens shows only instances matched by an active silence", async () => {
    const user = userEvent.setup();
    renderTriageRoute();
    await screen.findByText("Flapping check");

    await user.click(screen.getByRole("button", { name: "Silenced" }));

    // fp-3 (svc=api on the api-errors rule) is the one silenced instance.
    const board = screen.getByRole("region", { name: "Alert instances" });
    expect(within(board).getByText("api")).toBeInTheDocument();
    expect(within(board).getByText("api-errors")).toBeInTheDocument();
    expect(within(board).queryByText("web-1")).not.toBeInTheDocument();
  });

  it("All lens includes inactive instances", async () => {
    const user = userEvent.setup();
    renderTriageRoute();
    await screen.findByText("Flapping check");

    await user.click(screen.getByRole("button", { name: "All" }));

    const board = screen.getByRole("region", { name: "Alert instances" });
    expect(within(board).getByText("web-9")).toBeInTheDocument();
    expect(within(board).getByText("web-1")).toBeInTheDocument();
    expect(within(board).getByText("api")).toBeInTheDocument();
  });

  it("resolves the delivery fact through routes: receiver plus channels", async () => {
    renderTriageRoute();

    expect(await screen.findByText("oncall")).toBeInTheDocument();
    expect(screen.getByText(/team-slack, pd/)).toBeInTheDocument();
  });

  it("marks unrouted instances as not routed · no subscribers without firehose subscriptions", async () => {
    renderTriageRoute();

    // fp-2 (host=web-2) matches no route and there are no subscriptions.
    expect(
      await screen.findByText("not routed · no subscribers"),
    ).toBeInTheDocument();
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

    renderTriageRoute();

    expect(
      await screen.findByText("not routed · firehose only"),
    ).toBeInTheDocument();
  });

  it("expands a row in place with evidence, route matchers, transitions, and actions", async () => {
    const user = userEvent.setup();
    renderTriageRoute();

    await expandRowByLabel(user, "web-1");

    expect(
      screen.getByText("Fires when the flap condition holds."),
    ).toBeInTheDocument();
    expect(screen.getByText("status_code=500")).toBeInTheDocument();
    expect(screen.getByText("Route")).toBeInTheDocument();
    expect(screen.getByText("Recent transitions")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "1h" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "8h" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "24h" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Custom" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Runbook/ })).toBeInTheDocument();
    // The chevron reflects expansion state for assistive tech.
    expect(
      screen.getByRole("button", { name: "Collapse instance" }),
    ).toHaveAttribute("aria-expanded", "true");
  });

  it("shows recent transitions as relative time with the absolute timestamp in a title", async () => {
    // eventRow() defaults to a stored transition one minute in the past.
    const user = userEvent.setup();
    renderTriageRoute();

    await expandRowByLabel(user, "web-1");

    const relative = await screen.findByText("1m ago");
    // Live surfaces read relative; the absolute datetime is still available,
    // parked in the title (same idiom as the row's "since" cell).
    expect(relative.getAttribute("title")).toMatch(/\d{4}/);
    expect(relative.getAttribute("title")).not.toBe("1m ago");
  });

  it('labels the triage value column with the rule\'s value_column, falling back to "value"', async () => {
    mocks.listCcRules.mockResolvedValue([
      ccRule(), // value_column: null -> falls back to "value"
      ccRule({
        id: "rule-2",
        name: "default/api-errors",
        spec: {
          ...ccRule().spec,
          value_column: "val",
          severity: "warning",
          annotations: {},
        },
      }),
    ]);
    mocks.listCcAlerts.mockResolvedValue([
      ccAlert(),
      ccAlert({
        key: "fp-3",
        rule: "rule-2",
        labels: { svc: "api" },
        value: 7,
      }),
    ]);
    // The seeded silence matches svc=api, which would hide rule-2's instance
    // under the default Firing lens; not what this test is about.
    mocks.listCcSilences.mockResolvedValue([]);

    renderTriageRoute();

    // The label renders twice per group: the desktop column header and the
    // mobile inline prefix (visibility split via CSS, both in the DOM).
    expect((await screen.findAllByText("value")).length).toBeGreaterThan(0);
    expect(screen.getAllByText("val").length).toBeGreaterThan(0);
  });

  it("creates a rule-scoped silence from the row actions", async () => {
    const user = userEvent.setup();
    renderTriageRoute();

    await expandRowByLabel(user, "web-1");
    await user.click(screen.getByRole("button", { name: "1h" }));

    expect(mocks.createCcSilence).toHaveBeenCalledTimes(1);
    const { data } = mocks.createCcSilence.mock.calls[0][0] as {
      data: {
        matchers: { label: string; op: string; value: string }[];
        starts_at: string;
        ends_at: string;
      };
    };
    // Instance labels pinned with eq, plus the synthetic rule-scoping matcher.
    expect(data.matchers).toEqual([
      { label: "host", op: "eq", value: "web-1" },
      { label: "rule", op: "eq", value: "rule-1" },
    ]);
    const windowMs =
      new Date(data.ends_at).getTime() - new Date(data.starts_at).getTime();
    expect(windowMs).toBe(3_600_000);
  });

  it("polls only the newest event for the board and scopes the expanded row's feed by fingerprint", async () => {
    const user = userEvent.setup();
    renderTriageRoute();

    await expandRowByLabel(user, "web-1");
    await screen.findByText("status_code=500");

    const calls = mocks.listCcEventHistory.mock.calls.map(
      (c) => (c[0] as { data: Record<string, unknown> }).data,
    );
    // The collapsed board never fetches the full window: its only history
    // query is the newest-event freshness readout.
    expect(calls).toContainEqual(expect.objectContaining({ limit: 1 }));
    // The expanded row fetches its own instance's events, narrowed
    // server-side by fingerprint.
    expect(calls).toContainEqual(
      expect.objectContaining({ fingerprint: "fp-1" }),
    );
    expect(
      calls.every((c) => c.limit === 1 || c.fingerprint !== undefined),
    ).toBe(true);
  });

  it("renders SLO-sourced instances under the SLO's name with an SLO marker and tier badge, linked to the SLO detail page", async () => {
    mocks.listCcSlos.mockResolvedValue([ccSlo()]);
    mocks.listCcAlerts.mockResolvedValue([ccAlert(), sloAlert()]);

    renderTriageRoute();

    // The group header names the SLO (not the uuid), marks the origin, and
    // links to the SLO detail page rather than a rule page.
    const sloLink = await screen.findByRole("link", {
      name: "checkout-availability",
    });
    expect(sloLink).toHaveAttribute(
      "href",
      "/alerts/slos/default/checkout-availability",
    );
    expect(screen.getByText("SLO")).toBeInTheDocument();
    // The tier rides as a badge; the label pills keep the SLI group labels
    // without repeating slo_tier.
    expect(screen.getByText("fast-burn")).toBeInTheDocument();
    expect(screen.getByText("checkout")).toBeInTheDocument();
    // The value column header (and the mobile inline prefix) names the SLO's
    // metric.
    expect(screen.getAllByText("burn rate").length).toBeGreaterThan(0);
    // fast-burn is critical in the canonical tiers, so the group joins the
    // critical band alongside the rule-sourced group (two critical badges).
    expect(screen.getAllByText("critical").length).toBeGreaterThanOrEqual(1);
  });

  it("falls back to the short uuid for an SLO alert whose SLO is unknown, unlinked (no slug address to route to)", async () => {
    // The SLO list can lag a freshly-created SLO; the group must still render
    // as SLO-originated (the instance itself carries the slo id), but without
    // the SLO's own name/slug there is no address to build a slug link from.
    mocks.listCcAlerts.mockResolvedValue([sloAlert()]);

    renderTriageRoute();

    const name = await screen.findByText(SLO_ID.slice(0, 8));
    expect(name.tagName).not.toBe("A");
    expect(
      screen.queryByRole("link", { name: SLO_ID.slice(0, 8) }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("SLO")).toBeInTheDocument();
  });

  it("creates an slo-scoped silence from an SLO-sourced row", async () => {
    mocks.listCcSlos.mockResolvedValue([ccSlo()]);
    mocks.listCcAlerts.mockResolvedValue([sloAlert()]);
    const user = userEvent.setup();

    renderTriageRoute();

    await expandRowByLabel(user, "checkout");
    await user.click(screen.getByRole("button", { name: "1h" }));

    expect(mocks.createCcSilence).toHaveBeenCalledTimes(1);
    const { data } = mocks.createCcSilence.mock.calls[0][0] as {
      data: { matchers: { label: string; op: string; value: string }[] };
    };
    // Instance labels pinned with eq, plus the synthetic slo-scoping matcher
    // (the dispatcher stamps `slo` on SLO-originated events).
    expect(data.matchers).toEqual([
      { label: "service", op: "eq", value: "checkout" },
      { label: "slo_tier", op: "eq", value: "fast-burn" },
      { label: "slo", op: "eq", value: SLO_ID },
    ]);
  });

  it("shows the all-clear instrument when nothing is firing", async () => {
    mocks.listCcAlerts.mockResolvedValue([]);
    mocks.listCcSilences.mockResolvedValue([]);

    renderTriageRoute();

    expect(await screen.findByText("All clear")).toBeInTheDocument();
    expect(screen.getByText(/2 rules watching/)).toBeInTheDocument();
    expect(screen.getByText(/last event/)).toBeInTheDocument();
  });
});
