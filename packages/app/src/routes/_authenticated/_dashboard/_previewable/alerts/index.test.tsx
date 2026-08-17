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
import type { AlertEventLogRow } from "@/data/alerting/history/repository.server";
import { alertingRuleViewFixture } from "@/data/alerting/test-fixtures";
import type {
  AlertingAlert,
  AlertingReceiver,
  AlertingRoute,
  AlertingRuleView,
  AlertingSilence,
} from "@/data/alerting/types";
import { Route as AlertsIndexFileRoute } from "./index";

const mocks = vi.hoisted(() => ({
  listAlertingAlerts: vi.fn(),
  listAlertingRules: vi.fn(),
  listAlertingRoutes: vi.fn(),
  listAlertingReceivers: vi.fn(),
  listAlertingSilences: vi.fn(),
  listAlertingEventHistory: vi.fn(),
  createAlertingSilence: vi.fn(),
  expireAlertingSilence: vi.fn(),
  pauseAlertingRule: vi.fn(),
  resumeAlertingRule: vi.fn(),
  toastSuccess: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: {
    success: mocks.toastSuccess,
  },
}));

vi.mock("@/data/alerting/instances/server", () => ({
  listAlertingAlerts: mocks.listAlertingAlerts,
}));
vi.mock("@/data/alerting/rules/server", () => ({
  listAlertingRules: mocks.listAlertingRules,
  pauseAlertingRule: mocks.pauseAlertingRule,
  resumeAlertingRule: mocks.resumeAlertingRule,
}));
vi.mock("@/data/alerting/delivery/server", () => ({
  listAlertingRoutes: mocks.listAlertingRoutes,
  listAlertingReceivers: mocks.listAlertingReceivers,
}));
vi.mock("@/data/alerting/silences/server", () => ({
  listAlertingSilences: mocks.listAlertingSilences,
  createAlertingSilence: mocks.createAlertingSilence,
  expireAlertingSilence: mocks.expireAlertingSilence,
}));
vi.mock("@/data/alerting/history/server", () => ({
  listAlertingEventHistory: mocks.listAlertingEventHistory,
}));
vi.mock("@/data/alerting/routing/suggestions", () => ({
  listAlertingLabelKeys: vi.fn().mockResolvedValue([]),
  listAlertingLabelValues: vi.fn().mockResolvedValue([]),
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
  // The engine never sets `active_since` until an instance fires; a pending
  // instance's timeline lives in `pending_since` instead. So a "pending"
  // override must not inherit the firing defaults below.
  const status = overrides.status ?? "firing";
  return {
    key: "rule-1:fp-1",
    fingerprint: "fp-1",
    rule: "rule-1",
    tenant: "org1",
    status: "firing",
    labels: { host: "web-1" },
    value: 42,
    active_since:
      status === "pending"
        ? null
        : new Date(Date.now() - 300_000).toISOString(),
    pending_since:
      status === "pending"
        ? new Date(Date.now() - 120_000).toISOString()
        : null,
    last_seen: new Date().toISOString(),
    absent_count: 0,
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
    reason: "",
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
  mocks.listAlertingRoutes.mockResolvedValue([alertingRoute()]);
  mocks.listAlertingReceivers.mockResolvedValue([alertingReceiver()]);
  mocks.listAlertingSilences.mockResolvedValue([alertingSilence()]);
  mocks.listAlertingEventHistory.mockResolvedValue([eventRow()]);
}

function renderTriagePage(options: { initialEntry?: string } = {}) {
  const { initialEntry = "/alerts/" } = options;
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

async function expandRowByLabel(
  user: ReturnType<typeof userEvent.setup>,
  text: string,
) {
  await user.click(await screen.findByText(text));
}

/** Scopes queries to one rule's group section, since two seeded rules share
 *  the same evaluation interval and would otherwise collide on its text. */
function withinRuleGroup(board: HTMLElement, ruleName: string) {
  const identity = within(board).getByText(ruleName);
  const section = identity.closest("section");
  if (!section) throw new Error(`No group section for "${ruleName}"`);
  return within(section as HTMLElement);
}

beforeEach(() => {
  for (const fn of Object.values(mocks)) fn.mockReset();
  mocks.createAlertingSilence.mockResolvedValue(
    alertingSilence({ id: "sil-new" }),
  );
  mocks.expireAlertingSilence.mockResolvedValue({ expired: true });
  seedBoard();
});

describe("/alerts triage board", () => {
  it("heads the page as Triage", async () => {
    seedBoard();
    renderTriagePage();

    expect(
      await screen.findByRole("heading", { level: 1, name: "Triage" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: /rules watching/i }),
    ).not.toBeInTheDocument();
    // The rail replaces this shortcut in a later task.
    expect(
      screen.queryByRole("link", { name: "Delivery" }),
    ).not.toBeInTheDocument();
  });

  it("counts the whole pipeline and boards what is firing or pending", async () => {
    renderTriagePage();

    const strip = await screen.findByRole("region", {
      name: "Alerting pipeline",
    });
    expect(strip).toHaveTextContent("2 rules");
    expect(strip).toHaveTextContent("1 active silence");
    expect(within(strip).queryAllByRole("button")).toHaveLength(0);
    // The Watching cell is a plain count now: the rules it counts are listed
    // further down this same page.
    expect(
      within(strip).queryByRole("link", { name: "2 rules" }),
    ).not.toBeInTheDocument();

    // The board is triage, not inventory: inactive instances are counted by
    // the strip but not listed. Pending instances are listed too, since a
    // rule minutes from paging is the reader's business.
    const board = screen.getByRole("region", { name: "Active alerts" });
    expect(within(board).getByText("Flapping check")).toBeInTheDocument();
    expect(within(board).getByText("api-errors")).toBeInTheDocument();
    expect(within(board).getByText("web-1")).toBeInTheDocument();
    expect(within(board).getByText("api")).toBeInTheDocument();
    expect(within(board).getByText("web-2")).toBeInTheDocument();
    expect(within(board).queryByText("web-9")).toBeNull();
    // Every row names its state and duration together ("firing 12h"): the
    // age cell is self-describing, and pending rows say so too.
    expect(within(board).getAllByTitle(/^firing since /)).toHaveLength(2);
    expect(within(board).getAllByTitle(/^pending since /)).toHaveLength(1);
    expect(within(board).getByText("silenced")).toBeInTheDocument();
  });

  it("keeps a firing group above an all-pending group of higher severity", async () => {
    const warningRule = alertingRule({
      id: "rule-2",
      name: "default/api-errors",
      spec: { ...alertingRule().spec, severity: "warning", annotations: {} },
    });
    mocks.listAlertingRules.mockResolvedValue([alertingRule(), warningRule]);
    mocks.listAlertingAlerts.mockResolvedValue([
      // rule-1 is critical, but its only instance is pending, not firing.
      alertingAlert({
        status: "pending",
        labels: { host: "web-2" },
        value: null,
      }),
      // rule-2 is only warning, but it is genuinely firing.
      alertingAlert({
        key: "fp-3",
        rule: "rule-2",
        labels: { svc: "api" },
        value: 7,
      }),
    ]);
    mocks.listAlertingRoutes.mockResolvedValue([alertingRoute()]);
    mocks.listAlertingReceivers.mockResolvedValue([alertingReceiver()]);
    mocks.listAlertingSilences.mockResolvedValue([]);
    mocks.listAlertingEventHistory.mockResolvedValue([eventRow()]);

    renderTriagePage();

    const board = await screen.findByRole("region", { name: "Active alerts" });
    await within(board).findByText("api-errors");
    const text = board.textContent ?? "";
    const firingGroupAt = text.indexOf("api-errors");
    const pendingGroupAt = text.indexOf("Flapping check");
    expect(firingGroupAt).toBeGreaterThanOrEqual(0);
    expect(pendingGroupAt).toBeGreaterThan(firingGroupAt);
  });

  it("orders two pending groups by when they went pending, not by name", async () => {
    // Both groups are pending and equally severe, so the tie breaks on how long
    // each has been pending. The names are chosen so alphabetical order is the
    // opposite of the expected order: a board that cannot read a pending
    // instance's clock falls through to the name and puts "alpha" first.
    const alpha = alertingRule({
      id: "rule-alpha",
      name: "default/alpha",
      spec: { ...alertingRule().spec, annotations: {} },
    });
    const zeta = alertingRule({
      id: "rule-zeta",
      name: "default/zeta",
      spec: { ...alertingRule().spec, annotations: {} },
    });
    mocks.listAlertingRules.mockResolvedValue([alpha, zeta]);
    mocks.listAlertingAlerts.mockResolvedValue([
      alertingAlert({
        key: "alpha:fp",
        rule: "rule-alpha",
        status: "pending",
        labels: { host: "web-a" },
        value: null,
        pending_since: new Date(Date.now() - 600_000).toISOString(),
      }),
      alertingAlert({
        key: "zeta:fp",
        rule: "rule-zeta",
        status: "pending",
        labels: { host: "web-z" },
        value: null,
        pending_since: new Date(Date.now() - 60_000).toISOString(),
      }),
    ]);
    mocks.listAlertingRoutes.mockResolvedValue([alertingRoute()]);
    mocks.listAlertingReceivers.mockResolvedValue([alertingReceiver()]);
    mocks.listAlertingSilences.mockResolvedValue([]);
    mocks.listAlertingEventHistory.mockResolvedValue([eventRow()]);

    renderTriagePage();

    const board = await screen.findByRole("region", { name: "Active alerts" });
    await within(board).findByText("zeta");
    const text = board.textContent ?? "";
    expect(text.indexOf("zeta")).toBeLessThan(text.indexOf("alpha"));
  });

  it("shows a firing rule's health and evaluation interval, and pauses it from the board", async () => {
    seedBoard();
    mocks.pauseAlertingRule.mockResolvedValue({ ok: true });

    const user = userEvent.setup();
    renderTriagePage();

    const board = await screen.findByRole("region", { name: "Active alerts" });
    await within(board).findByText("Flapping check");
    const group = withinRuleGroup(board, "Flapping check");
    expect(group.getByText("Every 30s")).toBeInTheDocument();

    await user.click(group.getByRole("button", { name: "Pause" }));
    const confirm = await screen.findByRole("alertdialog");
    await user.click(
      within(confirm).getByRole("button", { name: "Pause rule" }),
    );

    await waitFor(() => expect(mocks.pauseAlertingRule).toHaveBeenCalled());
  });

  it("resolves a firing preview rule to its name and controls, and refreshes the list after pausing it, under ?preview=", async () => {
    const previewRule = alertingRule({
      id: "eeeeeeee-1111-2222-3333-444444444444",
      name: "default/preview-check",
      previewId: "pr-1",
      spec: {
        ...alertingRule().spec,
        annotations: { "everr.display.name": "Preview check" },
      },
    });
    // Only the preview-scoped call sees this rule: a page that forgot to ask
    // for the preview scope would get nothing back, and the firing instance
    // below would render as a bare id instead of "Preview check".
    mocks.listAlertingRules.mockImplementation(async (opts) =>
      opts?.data?.preview === "pr-1" ? [previewRule] : [],
    );
    mocks.listAlertingAlerts.mockResolvedValue([
      alertingAlert({
        key: "fp-preview",
        fingerprint: "fp-preview",
        rule: previewRule.id,
      }),
    ]);
    mocks.listAlertingRoutes.mockResolvedValue([]);
    mocks.listAlertingReceivers.mockResolvedValue([]);
    mocks.listAlertingSilences.mockResolvedValue([]);
    mocks.listAlertingEventHistory.mockResolvedValue([]);
    mocks.pauseAlertingRule.mockResolvedValue({ ok: true });

    const user = userEvent.setup();
    renderTriagePage({ initialEntry: "/alerts/?preview=pr-1" });

    const board = await screen.findByRole("region", { name: "Active alerts" });
    await within(board).findByText("Preview check");
    expect(within(board).queryByText("eeeeeeee")).not.toBeInTheDocument();
    const group = withinRuleGroup(board, "Preview check");
    expect(group.getByText("Every 30s")).toBeInTheDocument();

    const callsBeforePause = mocks.listAlertingRules.mock.calls.length;
    await user.click(group.getByRole("button", { name: "Pause" }));
    const confirm = await screen.findByRole("alertdialog");
    await user.click(
      within(confirm).getByRole("button", { name: "Pause rule" }),
    );

    await waitFor(() => expect(mocks.pauseAlertingRule).toHaveBeenCalled());
    // The invalidation after a pause must target the SAME preview scope the
    // page is reading, or the refreshed list never lands.
    await waitFor(() =>
      expect(mocks.listAlertingRules.mock.calls.length).toBeGreaterThan(
        callsBeforePause,
      ),
    );
    expect(mocks.listAlertingRules).toHaveBeenLastCalledWith({
      data: { preview: "pr-1" },
    });
  });

  it("names each row's controls after the row, not 'instance'", async () => {
    const user = userEvent.setup();
    renderTriagePage();
    const board = await screen.findByRole("region", { name: "Active alerts" });

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
    // Only host=web-1 matches the route. The svc=api row is intentionally
    // silenced, so it must never read as a delivery failure, even though the
    // pending host=web-2 row genuinely has nowhere to go once it fires.
    const silencedRow = (
      await screen.findByRole("button", { name: "Expand svc=api" })
    ).closest("div") as HTMLElement;
    expect(within(silencedRow).queryByText("Not delivered")).toBeNull();
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
      alertingReceiver({
        id: "recv-2",
        name: "backup",
        channels: ["ops-hook"],
      }),
      alertingReceiver({ id: "recv-3", name: "mgmt", channels: ["ops-hook"] }),
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

    // Both the firing and the pending row lack a route, but the banner
    // counts only the firing one: a pending alert has nothing to deliver yet.
    expect(await screen.findAllByText("Not delivered")).toHaveLength(2);
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
    // expanded detail's full-width action. Each is pinned by its own
    // accessible name, so either one disappearing fails the assertion.
    expect(
      screen.getAllByRole("link", { name: "Open runbook for Flapping check" }),
    ).not.toHaveLength(0);
    expect(screen.getByRole("link", { name: "Runbook" })).toBeInTheDocument();
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

  it("falls back to the short source id, unlinked, when a listing has not caught up", async () => {
    const unknownRuleId = "unknown-rule-id";
    mocks.listAlertingAlerts.mockResolvedValue([
      alertingAlert({ rule: unknownRuleId }),
    ]);

    renderTriagePage();

    await screen.findByText(unknownRuleId.slice(0, 8));
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
      expect(mocks.expireAlertingSilence).toHaveBeenCalledWith({
        data: { id: "sil-new" },
      }),
    );
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
      screen.queryByRole("region", { name: "Active alerts" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("region", { name: "Alerting pipeline" }),
    ).not.toBeInTheDocument();
  });

  it("says the event read failed rather than claiming no events", async () => {
    mocks.listAlertingAlerts.mockResolvedValue([]);
    mocks.listAlertingSilences.mockResolvedValue([]);
    // The events read only date-stamps the readout, so losing it must not cost
    // the all-clear itself. However, "no events in 24h" would be a claim we cannot
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
