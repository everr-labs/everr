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
import type { AlertSummary } from "@/data/alerts/server";
import type { CcAlert, CcSilence } from "@/data/cc/types";
import { Route as AlertsFileRoute } from "./alerts";

// ---------------------------------------------------------------------------
// Mocks, at the same module boundaries as
// src/routes/_authenticated/_dashboard/_explore/errors.test.tsx: the data
// modules the route talks to, plus AlertEventFeed (mocked to a sentinel — its
// own behavior is covered by alert-event-feed.test.tsx) and the CC
// invalidation hook (it opens a real EventSource, unavailable in jsdom).
//
// The fns are built with `vi.hoisted` (not plain top-level `const`s, and not
// `importOriginal` — the real alerts/server module pulls in db/client.ts,
// which trips a server-only-env-var guard under jsdom) so the `vi.mock`
// factories, hoisted above these imports, can reference them safely.
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({
  listAlerts: vi.fn(),
  getAlertSettings: vi.fn(),
  updateAlertSettings: vi.fn(),
  listCcAlerts: vi.fn(),
  listCcSilences: vi.fn(),
  createCcSilence: vi.fn(),
  deleteCcSilence: vi.fn(),
}));

vi.mock("@/data/alerts/server", () => ({
  listAlerts: mocks.listAlerts,
  getAlertSettings: mocks.getAlertSettings,
  updateAlertSettings: mocks.updateAlertSettings,
}));

vi.mock("@/data/cc/server", () => ({
  listCcAlerts: mocks.listCcAlerts,
  listCcSilences: mocks.listCcSilences,
  createCcSilence: mocks.createCcSilence,
  deleteCcSilence: mocks.deleteCcSilence,
}));

vi.mock("@/components/cc/alert-event-feed", () => ({
  AlertEventFeed: () => <div>Activity feed sentinel</div>,
}));

vi.mock("@/hooks/use-cc-invalidation", () => ({
  useCcInvalidation: () => undefined,
}));

let alertsData: AlertSummary[] = [];
mocks.listAlerts.mockImplementation(() => Promise.resolve(alertsData));
mocks.getAlertSettings.mockImplementation(() =>
  Promise.resolve({
    delivery: {
      email: { enabled: false, to: [] },
      telegram: { enabled: false, botToken: "", chatIds: [] },
      slack: { enabled: false, webhookUrl: "" },
      remindEverySeconds: null,
    },
  }),
);

let ccAlertsData: CcAlert[] = [];
let ccSilencesData: CcSilence[] = [];
mocks.listCcAlerts.mockImplementation(() => Promise.resolve(ccAlertsData));
mocks.listCcSilences.mockImplementation(() => Promise.resolve(ccSilencesData));
mocks.createCcSilence.mockImplementation(
  (opts: {
    data: {
      matchers: { label: string; op: string; value: string }[];
      starts_at: string;
      ends_at: string;
      comment?: string;
    };
  }) => {
    const created: CcSilence = {
      id: `silence-${ccSilencesData.length + 1}`,
      tenant: "t1",
      matchers: opts.data.matchers as CcSilence["matchers"],
      starts_at: opts.data.starts_at,
      ends_at: opts.data.ends_at,
      comment: opts.data.comment ?? null,
      author: null,
      created_at: new Date().toISOString(),
    };
    ccSilencesData = [...ccSilencesData, created];
    return Promise.resolve(created);
  },
);
mocks.deleteCcSilence.mockImplementation((opts: { data: { id: string } }) => {
  ccSilencesData = ccSilencesData.filter((s) => s.id !== opts.data.id);
  return Promise.resolve(undefined);
});

const {
  listAlerts,
  getAlertSettings,
  updateAlertSettings,
  listCcAlerts,
  listCcSilences,
  createCcSilence,
  deleteCcSilence,
} = mocks;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function alertSummary(overrides: Partial<AlertSummary> = {}): AlertSummary {
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
    lastFiredAt: null,
    lastResolvedAt: "2026-07-05T00:00:00.000Z",
    lastSeenAt: "2026-07-05T00:00:00.000Z",
    firingInstanceCount: 0,
    activeSilenceCount: 0,
    activeSilenceExpiresAt: null,
    runbookProject: null,
    runbookSlug: null,
    previewId: null,
    ownedByRepo: null,
    ...overrides,
  };
}

function ccAlert(overrides: Partial<CcAlert> = {}): CcAlert {
  return {
    key: "rule-1|team=pay",
    rule: "rule-1",
    tenant: "t1",
    status: "firing",
    labels: { team: "pay" },
    value: 42,
    active_since: "2026-07-05T00:00:00.000Z",
    last_seen: "2026-07-05T00:00:00.000Z",
    absent_count: 0,
    ...overrides,
  };
}

function ccSilence(overrides: Partial<CcSilence> = {}): CcSilence {
  const now = Date.now();
  return {
    id: "silence-active",
    tenant: "t1",
    matchers: [{ label: "team", op: "eq", value: "pay" }],
    starts_at: new Date(now - 60_000).toISOString(),
    ends_at: new Date(now + 60 * 60_000).toISOString(),
    comment: "maintenance window",
    author: null,
    created_at: new Date(now - 120_000).toISOString(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

function renderAlertsRoute(initialEntries: string[]) {
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
  // The real route's `loader` prefetches via the app's `RouterContext`
  // (`{ queryClient }` typed against the app-wide `Register`), which this
  // ad hoc tree doesn't provide — the component's own `useQuery` calls fetch
  // (via the mocked data modules) regardless, so the loader is skipped here
  // rather than fought into an unrelated fake context type.
  const alertsRoute = createRoute({
    getParentRoute: () => previewableRoute,
    path: "alerts",
    validateSearch: AlertsFileRoute.options.validateSearch,
    search: AlertsFileRoute.options.search,
    component: AlertsFileRoute.options.component,
  });
  const alertDetailRoute = createRoute({
    getParentRoute: () => previewableRoute,
    path: "alerts/$alertId",
    component: () => <div>Alert detail stub</div>,
  });

  const routeTree = rootRoute.addChildren([
    authenticatedRoute.addChildren([
      dashboardRoute.addChildren([
        previewableRoute.addChildren([alertsRoute, alertDetailRoute]),
      ]),
    ]),
  ]);

  const history = createMemoryHistory({ initialEntries });
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

describe("/alerts route", () => {
  beforeEach(() => {
    alertsData = [];
    ccAlertsData = [];
    ccSilencesData = [];
    listAlerts.mockClear();
    getAlertSettings.mockClear();
    updateAlertSettings.mockClear();
    listCcAlerts.mockClear();
    listCcSilences.mockClear();
    createCcSilence.mockClear();
    deleteCcSilence.mockClear();
  });

  it("renders the alerts list by default", async () => {
    alertsData = [alertSummary()];

    renderAlertsRoute(["/alerts"]);

    expect(await screen.findByText("high-error-rate")).toBeInTheDocument();
    expect(
      screen.queryByText("Activity feed sentinel"),
    ).not.toBeInTheDocument();
  });

  it("renders the activity feed for ?view=activity", async () => {
    alertsData = [alertSummary()];

    renderAlertsRoute(["/alerts?view=activity"]);

    expect(
      await screen.findByText("Activity feed sentinel"),
    ).toBeInTheDocument();
    expect(screen.queryByText("high-error-rate")).not.toBeInTheDocument();
  });

  it("switches to the activity tab via the tab link", async () => {
    alertsData = [alertSummary()];
    const user = userEvent.setup();

    const { router } = renderAlertsRoute(["/alerts"]);
    await screen.findByText("high-error-rate");

    await user.click(screen.getByRole("tab", { name: "Activity" }));

    expect(
      await screen.findByText("Activity feed sentinel"),
    ).toBeInTheDocument();
    expect(router.state.location.search).toEqual({ view: "activity" });
  });

  it("expands a firing alert row to show its firing instance with a mute action", async () => {
    alertsData = [
      alertSummary({
        currentState: "firing",
        lastFiredAt: "2026-07-05T00:00:00.000Z",
        firingInstanceCount: 1,
      }),
    ];
    ccAlertsData = [ccAlert()];
    const user = userEvent.setup();

    renderAlertsRoute(["/alerts"]);
    await screen.findByText("high-error-rate");

    await user.click(
      screen.getByRole("button", { name: /expand firing detail/i }),
    );

    expect(await screen.findByText("team")).toBeInTheDocument();
    expect(screen.getByText("pay")).toBeInTheDocument();
    expect(screen.getByText(/value 42/)).toBeInTheDocument();
    expect(screen.getByText(/firing on/i)).toBeInTheDocument();

    const muteButton = screen.getByRole("button", { name: "Mute" });
    await user.click(muteButton);

    await waitFor(() => expect(createCcSilence).toHaveBeenCalledTimes(1));
    const call = createCcSilence.mock.calls[0]?.[0] as {
      data: {
        matchers: { label: string; op: string; value: string }[];
        starts_at: string;
        ends_at: string;
        comment?: string;
      };
    };
    expect(call.data.matchers).toEqual([
      { label: "team", op: "eq", value: "pay" },
    ]);
    expect(call.data.comment).toBe("Muted from alerts list");
    const durationMs =
      new Date(call.data.ends_at).getTime() -
      new Date(call.data.starts_at).getTime();
    expect(durationMs).toBe(2 * 60 * 60 * 1000);
  });

  it("does not offer expansion on non-firing rows", async () => {
    alertsData = [alertSummary({ currentState: "resolved" })];

    renderAlertsRoute(["/alerts"]);
    await screen.findByText("high-error-rate");

    expect(
      screen.queryByRole("button", { name: /expand firing detail/i }),
    ).not.toBeInTheDocument();
  });

  it("shows the mutes pill and cancels an active mute from the panel", async () => {
    alertsData = [alertSummary()];
    ccSilencesData = [ccSilence()];
    const user = userEvent.setup();

    renderAlertsRoute(["/alerts"]);

    const pill = await screen.findByRole("button", { name: /1 mute active/i });
    await user.click(pill);

    const panel = await screen.findByText("Active mutes");
    const panelContainer = panel.closest('[data-slot="popover-content"]');
    expect(panelContainer).not.toBeNull();
    expect(
      within(panelContainer as HTMLElement).getByText("maintenance window"),
    ).toBeInTheDocument();

    const cancelButton = within(panelContainer as HTMLElement).getByRole(
      "button",
      { name: "Cancel" },
    );
    await user.click(cancelButton);

    await waitFor(() =>
      expect(deleteCcSilence).toHaveBeenCalledWith({
        data: { id: "silence-active" },
      }),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: /mute active/i }),
      ).not.toBeInTheDocument(),
    );
  });

  it("never renders the word 'silence' in the alerts home", async () => {
    alertsData = [
      alertSummary({
        currentState: "firing",
        lastFiredAt: "2026-07-05T00:00:00.000Z",
        firingInstanceCount: 1,
      }),
    ];
    ccAlertsData = [ccAlert()];
    ccSilencesData = [ccSilence()];

    renderAlertsRoute(["/alerts"]);

    await screen.findByText("high-error-rate");
    await screen.findByRole("button", { name: /1 mute active/i });

    expect(document.body.textContent?.toLowerCase()).not.toContain("silence");
  });
});
