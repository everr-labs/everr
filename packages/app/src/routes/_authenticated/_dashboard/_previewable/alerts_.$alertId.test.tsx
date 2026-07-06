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
import { z } from "zod";
import type {
  AlertInstanceSummary,
  AlertSilenceSummary,
  getAlert,
} from "@/data/alerts/server";
import type { CcRoute } from "@/data/cc/types";
import { Route as AlertDetailFileRoute } from "./alerts_.$alertId";

// ---------------------------------------------------------------------------
// Mocks, at the same module boundaries as
// _previewable/alerts.test.tsx: the data modules the route talks to, plus
// AlertEventFeed (mocked to a sentinel that surfaces its `scopeSlug` prop —
// its own behavior is covered by alert-event-feed.test.tsx) and the CC
// invalidation hook (it opens a real EventSource, unavailable in jsdom).
//
// This route also imports `alertSettingsQueryOptions` from the alerts LIST
// route module ("./alerts") for the Notifies preview, which pulls in that
// module's own top-level imports (listAlerts, createSilence from
// @/data/alerts/server; listCcAlerts/listCcSilences/deleteCcSilence from
// @/data/cc/server) — stubbed below even though unused directly, mirroring
// alerts_.notifications.test.tsx.
// ---------------------------------------------------------------------------

type AlertDetail = Awaited<ReturnType<typeof getAlert>>;

const mocks = vi.hoisted(() => ({
  getAlert: vi.fn(),
  listAlertInstances: vi.fn(),
  listAlertSilences: vi.fn(),
  createSilence: vi.fn(),
  cancelSilence: vi.fn(),
  activateAlert: vi.fn(),
  deactivateAlert: vi.fn(),
  testAlert: vi.fn(),
  getAlertSettings: vi.fn(),
  listAlerts: vi.fn(),
  listCcRoutes: vi.fn(),
  listCcAlerts: vi.fn(),
  listCcSilences: vi.fn(),
  deleteCcSilence: vi.fn(),
}));

vi.mock("@/data/alerts/server", () => ({
  getAlert: mocks.getAlert,
  listAlertInstances: mocks.listAlertInstances,
  listAlertSilences: mocks.listAlertSilences,
  createSilence: mocks.createSilence,
  cancelSilence: mocks.cancelSilence,
  activateAlert: mocks.activateAlert,
  deactivateAlert: mocks.deactivateAlert,
  testAlert: mocks.testAlert,
  getAlertSettings: mocks.getAlertSettings,
  listAlerts: mocks.listAlerts,
  RULE_LABEL: "rule",
}));

vi.mock("@/data/cc/server", () => ({
  listCcRoutes: mocks.listCcRoutes,
  listCcAlerts: mocks.listCcAlerts,
  listCcSilences: mocks.listCcSilences,
  deleteCcSilence: mocks.deleteCcSilence,
}));

vi.mock("@/components/cc/alert-event-feed", () => ({
  AlertEventFeed: ({ scopeSlug }: { scopeSlug?: string }) => (
    <div>Timeline sentinel scope={scopeSlug ?? "none"}</div>
  ),
}));

vi.mock("@/hooks/use-cc-invalidation", () => ({
  useCcInvalidation: () => undefined,
}));

const defaultDelivery = {
  email: { enabled: false, to: [] },
  telegram: { enabled: false, botToken: "", chatIds: [] },
  slack: { enabled: false, webhookUrl: "" },
  remindEverySeconds: null,
};

mocks.listAlerts.mockImplementation(() => Promise.resolve([]));
mocks.listCcAlerts.mockImplementation(() => Promise.resolve([]));
mocks.listCcSilences.mockImplementation(() => Promise.resolve([]));
mocks.deleteCcSilence.mockImplementation(() => Promise.resolve(undefined));

const {
  getAlert: getAlertMock,
  listAlertInstances,
  listAlertSilences,
  createSilence,
  cancelSilence,
  activateAlert,
  deactivateAlert,
  testAlert,
  getAlertSettings,
  listCcRoutes,
} = mocks;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function alertDetail(overrides: Partial<AlertDetail> = {}): AlertDetail {
  return {
    id: "rule-1",
    repoid: "repo",
    slug: "high-error-rate",
    displayName: "High error rate",
    evaluationIntervalSeconds: 60,
    severity: "critical",
    currentState: "resolved",
    active: true,
    health: "healthy",
    healthError: null,
    healthConsecutiveFailures: 0,
    healthLastErrorAt: null,
    lastFiredAt: null,
    lastResolvedAt: null,
    lastSeenAt: "2026-07-05T00:00:00.000Z",
    firingInstanceCount: 0,
    activeSilenceCount: 0,
    activeSilenceExpiresAt: null,
    runbookProject: null,
    runbookSlug: null,
    previewId: null,
    ownedByRepo: null,
    previewStatus: undefined,
    display: { name: "High error rate", description: undefined },
    parsedQuery: "select 1",
    notificationTitleTemplate: "High error rate",
    notificationDescriptionTemplate: "",
    instanceLabelColumns: [],
    forSeconds: 0,
    resolveAfter: 1,
    valueColumn: null,
    version: 1,
    maxIntervalSecs: null,
    suppressed: false,
    ...overrides,
  } as AlertDetail;
}

function alertInstance(
  overrides: Partial<AlertInstanceSummary> = {},
): AlertInstanceSummary {
  return {
    fingerprint: "rule-1|team=pay",
    labels: { team: "pay" },
    state: "firing",
    lastFiredAt: "2026-07-05T00:00:00.000Z",
    lastResolvedAt: null,
    lastRow: {},
    lastEvaluationRows: [],
    lastEvaluationTitle: null,
    lastEvaluationDescription: null,
    silenced: false,
    ...overrides,
  };
}

function ccRoute(overrides: Partial<CcRoute> = {}): CcRoute {
  return {
    id: "route-1",
    tenant: "t1",
    matchers: [],
    receiver: "oncall",
    continue: false,
    priority: 0,
    group_by: null,
    group_wait_secs: null,
    group_interval_secs: null,
    repeat_interval_secs: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

function renderDetailRoute(alertId = "rule-1") {
  const rootRoute = createRootRoute({ component: Outlet });
  const authenticatedRoute = createRoute({
    getParentRoute: () => rootRoute,
    id: "_authenticated",
    component: Outlet,
  });
  const dashboardSearchSchema = z.object({
    preview: z.string().max(200).optional().catch(undefined),
  });
  const dashboardRoute = createRoute({
    getParentRoute: () => authenticatedRoute,
    id: "_dashboard",
    validateSearch: dashboardSearchSchema,
    component: Outlet,
  });
  const previewableRoute = createRoute({
    getParentRoute: () => dashboardRoute,
    id: "_previewable",
    component: Outlet,
  });
  // Mirrors alerts.test.tsx: the real route's loader needs the app-wide
  // RouterContext, so this ad hoc tree skips it — the component's own
  // useQuery calls fetch via the mocked data modules regardless.
  const alertDetailRoute = createRoute({
    getParentRoute: () => previewableRoute,
    path: "alerts/$alertId",
    component: AlertDetailFileRoute.options.component,
  });

  const routeTree = rootRoute.addChildren([
    authenticatedRoute.addChildren([
      dashboardRoute.addChildren([
        previewableRoute.addChildren([alertDetailRoute]),
      ]),
    ]),
  ]);

  const history = createMemoryHistory({
    initialEntries: [`/alerts/${alertId}`],
  });
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const router = createRouter({
    routeTree,
    history,
    context: { queryClient },
  });

  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { router, queryClient };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("/alerts/$alertId route", () => {
  beforeEach(() => {
    getAlertMock.mockReset();
    listAlertInstances.mockReset();
    listAlertSilences.mockReset();
    createSilence.mockReset();
    cancelSilence.mockReset();
    activateAlert.mockReset();
    deactivateAlert.mockReset();
    testAlert.mockReset();
    getAlertSettings.mockReset();
    listCcRoutes.mockReset();

    listAlertInstances.mockImplementation(() => Promise.resolve([]));
    listAlertSilences.mockImplementation(() => Promise.resolve([]));
    createSilence.mockImplementation(() => Promise.resolve(undefined));
    cancelSilence.mockImplementation(() => Promise.resolve(undefined));
    getAlertSettings.mockImplementation(() =>
      Promise.resolve({ delivery: defaultDelivery }),
    );
    listCcRoutes.mockImplementation(() => Promise.resolve([]));
  });

  it("renders the sections in order: Status, Timeline, Definition, Notifies, Mutes", async () => {
    getAlertMock.mockImplementation(() => Promise.resolve(alertDetail()));

    renderDetailRoute();

    await screen.findByRole("heading", { name: "High error rate" });
    const headings = Array.from(
      document.querySelectorAll('[data-slot="card-title"]'),
    ).map((el) => el.textContent?.trim());

    expect(headings).toEqual([
      "Status",
      "Timeline",
      "Definition",
      "Notifies",
      "Mutes",
    ]);
  });

  it("reveals the spec facts and health forensics in the collapsed Advanced block", async () => {
    getAlertMock.mockImplementation(() =>
      Promise.resolve(
        alertDetail({
          id: "rule-42",
          version: 7,
          instanceLabelColumns: ["team", "region"],
          valueColumn: "error_rate",
          resolveAfter: 3,
          maxIntervalSecs: 900,
          suppressed: true,
          health: "degraded",
          healthConsecutiveFailures: 4,
          healthError: "connection refused",
          healthLastErrorAt: "2026-07-04T23:00:00.000Z",
        }),
      ),
    );
    const user = userEvent.setup();

    renderDetailRoute();
    await screen.findByRole("heading", { name: "High error rate" });

    // Collapsed by default: the facts aren't in the DOM yet.
    expect(screen.queryByText("rule-42")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Advanced" }));

    const advanced = within(await screen.findByTestId("advanced-definition"));
    expect(advanced.getByText("rule-42")).toBeInTheDocument();
    expect(advanced.getByText("7")).toBeInTheDocument();
    expect(advanced.getByText("team, region")).toBeInTheDocument();
    expect(advanced.getByText("error_rate")).toBeInTheDocument();
    expect(advanced.getByText("3 empty evaluations")).toBeInTheDocument();
    expect(advanced.getByText("15m")).toBeInTheDocument();
    expect(advanced.getByText("Yes")).toBeInTheDocument();
    expect(advanced.getByText("degraded")).toBeInTheDocument();
    expect(advanced.getByText("4")).toBeInTheDocument();
    expect(advanced.getByText("connection refused")).toBeInTheDocument();
  });

  it("renders a pending label set in Status, muted and separate from firing", async () => {
    getAlertMock.mockImplementation(() => Promise.resolve(alertDetail()));
    listAlertInstances.mockImplementation(() =>
      Promise.resolve([
        alertInstance({
          fingerprint: "rule-1|team=pay",
          labels: { team: "pay" },
          state: "firing",
        }),
        alertInstance({
          fingerprint: "rule-1|team=eng",
          labels: { team: "eng" },
          state: "pending",
        }),
      ]),
    );

    renderDetailRoute();

    expect(await screen.findByText("Firing on")).toBeInTheDocument();
    expect(screen.getByText("about to fire (pending)")).toBeInTheDocument();
    expect(screen.getByText("eng")).toBeInTheDocument();
  });

  it("mounts the timeline scoped to the alert's slug for an owned rule", async () => {
    getAlertMock.mockImplementation(() =>
      Promise.resolve(alertDetail({ id: "rule-1", slug: "high-error-rate" })),
    );

    renderDetailRoute();

    expect(
      await screen.findByText("Timeline sentinel scope=high-error-rate"),
    ).toBeInTheDocument();
  });

  it("falls back to the rule id for a bare rule with no everr.name annotation", async () => {
    getAlertMock.mockImplementation(() =>
      Promise.resolve(
        alertDetail({ id: "rule-bare-1", slug: "", displayName: null }),
      ),
    );

    renderDetailRoute("rule-bare-1");

    expect(
      await screen.findByText("Timeline sentinel scope=rule-bare-1"),
    ).toBeInTheDocument();
  });

  it("shows the mute dialog presets and creates a mute with the chosen duration", async () => {
    getAlertMock.mockImplementation(() => Promise.resolve(alertDetail()));
    const user = userEvent.setup();

    renderDetailRoute();
    await screen.findByRole("heading", { name: "High error rate" });

    await user.click(screen.getByRole("button", { name: "Add mute" }));
    await screen.findByText("Mute alert");

    expect(screen.getByRole("button", { name: "1h" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "8h" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "24h" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Custom" })).toBeInTheDocument();

    const before = Date.now();
    await user.click(screen.getByRole("button", { name: "8h" }));
    await user.click(screen.getByRole("button", { name: "Create mute" }));

    await waitFor(() => expect(createSilence).toHaveBeenCalledTimes(1));
    const call = createSilence.mock.calls[0]?.[0] as {
      data: { alertId: string; endsAt: string; matchers: unknown[] };
    };
    expect(call.data.alertId).toBe("rule-1");
    expect(call.data.matchers).toEqual([]);
    const durationMs = new Date(call.data.endsAt).getTime() - before;
    expect(durationMs).toBeGreaterThanOrEqual(8 * 3_600_000);
    expect(durationMs).toBeLessThan(8 * 3_600_000 + 10_000);
  });

  it("disables Create mute for an unparsable or non-positive custom hours value", async () => {
    getAlertMock.mockImplementation(() => Promise.resolve(alertDetail()));
    const user = userEvent.setup();

    renderDetailRoute();
    await screen.findByRole("heading", { name: "High error rate" });

    await user.click(screen.getByRole("button", { name: "Add mute" }));
    await screen.findByText("Mute alert");
    await user.click(screen.getByRole("button", { name: "Custom" }));

    const createButton = screen.getByRole("button", { name: "Create mute" });
    const customHoursInput = screen.getByLabelText("Custom duration in hours");

    // A non-empty but unparsable/non-positive value must stay disabled: the
    // fix guards on the parsed number, not on emptiness.
    await user.clear(customHoursInput);
    await user.type(customHoursInput, "abc");
    expect(createButton).toBeDisabled();

    await user.clear(customHoursInput);
    await user.type(customHoursInput, "0");
    expect(createButton).toBeDisabled();

    await user.clear(customHoursInput);
    await user.type(customHoursInput, "-5");
    expect(createButton).toBeDisabled();

    await user.clear(customHoursInput);
    await user.type(customHoursInput, "3");
    expect(createButton).not.toBeDisabled();
  });

  it("dedupes Notifies when a custom route's receiver names a default channel", async () => {
    getAlertMock.mockImplementation(() =>
      Promise.resolve(alertDetail({ severity: "critical" })),
    );
    getAlertSettings.mockImplementation(() =>
      Promise.resolve({
        delivery: { ...defaultDelivery, email: { enabled: true, to: [] } },
      }),
    );
    listCcRoutes.mockImplementation(() =>
      Promise.resolve([
        ccRoute({
          id: "route-email",
          receiver: "email",
          matchers: [{ label: "severity", op: "eq", value: "critical" }],
        }),
      ]),
    );

    renderDetailRoute();

    const notifies = await screen.findByText(/^Notifies /);
    expect(notifies.textContent).toBe("Notifies email.");
  });

  it("prefills match specific labels from a firing row's mute action", async () => {
    getAlertMock.mockImplementation(() => Promise.resolve(alertDetail()));
    listAlertInstances.mockImplementation(() =>
      Promise.resolve([alertInstance({ labels: { team: "pay" } })]),
    );
    const user = userEvent.setup();

    renderDetailRoute();
    await screen.findByText("Firing on");

    await user.click(screen.getByRole("button", { name: "Mute" }));
    await screen.findByText("Mute alert");

    expect(screen.getByDisplayValue("team")).toBeInTheDocument();
    expect(screen.getByDisplayValue("pay")).toBeInTheDocument();
  });

  it("renders the notified channels from the mocked routes and settings", async () => {
    getAlertMock.mockImplementation(() =>
      Promise.resolve(alertDetail({ severity: "critical" })),
    );
    getAlertSettings.mockImplementation(() =>
      Promise.resolve({
        delivery: {
          ...defaultDelivery,
          email: { enabled: true, to: ["a@b.com"] },
        },
      }),
    );
    listCcRoutes.mockImplementation(() =>
      Promise.resolve([
        ccRoute({
          id: "managed",
          receiver: "everr-default-email",
          matchers: [],
          priority: 1000,
        }),
        ccRoute({
          id: "custom",
          receiver: "oncall",
          matchers: [{ label: "severity", op: "eq", value: "critical" }],
          priority: 10,
        }),
      ]),
    );

    renderDetailRoute();

    expect(
      await screen.findByText("Notifies email and oncall."),
    ).toBeInTheDocument();
  });

  it("shows 'No channels configured' with a link when nothing matches", async () => {
    getAlertMock.mockImplementation(() => Promise.resolve(alertDetail()));

    renderDetailRoute();
    await screen.findByRole("heading", { name: "High error rate" });

    expect(
      await screen.findByText(/no channels configured/i),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /configure notifications/i }),
    ).toHaveAttribute("href", "/alerts/notifications");
  });

  it("never renders the words 'silence' or 'instance'", async () => {
    getAlertMock.mockImplementation(() => Promise.resolve(alertDetail()));
    listAlertInstances.mockImplementation(() =>
      Promise.resolve([alertInstance()]),
    );
    listAlertSilences.mockImplementation(() =>
      Promise.resolve([
        {
          id: "mute-1",
          startsAt: new Date(),
          endsAt: new Date(Date.now() + 3_600_000),
          reason: "maintenance",
          createdByUserId: "user-1",
          matchers: [],
        } satisfies AlertSilenceSummary,
      ]),
    );

    renderDetailRoute();
    await screen.findByRole("heading", { name: "High error rate" });
    await screen.findByText((content) => content.includes("maintenance"));

    const text = document.body.textContent?.toLowerCase() ?? "";
    expect(text).not.toContain("silence");
    expect(text).not.toContain("instance");
  });
});
