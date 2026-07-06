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
import type { CcAlert, CcRoute, CcSilence } from "@/data/cc/types";
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
  createSilence: vi.fn(),
  createCcSilence: vi.fn(),
  listCcAlerts: vi.fn(),
  listCcSilences: vi.fn(),
  deleteCcSilence: vi.fn(),
  listCcRoutes: vi.fn(),
}));

vi.mock("@/data/alerts/server", () => ({
  listAlerts: mocks.listAlerts,
  getAlertSettings: mocks.getAlertSettings,
  updateAlertSettings: mocks.updateAlertSettings,
  createSilence: mocks.createSilence,
  RULE_LABEL: "rule",
}));

vi.mock("@/data/cc/server", () => ({
  createCcSilence: mocks.createCcSilence,
  listCcAlerts: mocks.listCcAlerts,
  listCcSilences: mocks.listCcSilences,
  deleteCcSilence: mocks.deleteCcSilence,
  listCcRoutes: mocks.listCcRoutes,
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
let ccRoutesData: CcRoute[] = [];
mocks.listCcAlerts.mockImplementation(() => Promise.resolve(ccAlertsData));
mocks.listCcSilences.mockImplementation(() => Promise.resolve(ccSilencesData));
mocks.listCcRoutes.mockImplementation(() => Promise.resolve(ccRoutesData));
mocks.createSilence.mockImplementation(() => Promise.resolve(undefined));
mocks.createCcSilence.mockImplementation(() => Promise.resolve(undefined));
mocks.deleteCcSilence.mockImplementation((opts: { data: { id: string } }) => {
  ccSilencesData = ccSilencesData.filter((s) => s.id !== opts.data.id);
  return Promise.resolve(undefined);
});

const {
  listAlerts,
  getAlertSettings,
  updateAlertSettings,
  createSilence,
  createCcSilence,
  listCcAlerts,
  listCcSilences,
  deleteCcSilence,
  listCcRoutes,
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
    healthConsecutiveFailures: 0,
    healthLastErrorAt: null,
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
    ccRoutesData = [];
    listAlerts.mockClear();
    getAlertSettings.mockClear();
    updateAlertSettings.mockClear();
    createSilence.mockClear();
    createCcSilence.mockClear();
    listCcAlerts.mockClear();
    listCcSilences.mockClear();
    deleteCcSilence.mockClear();
    listCcRoutes.mockClear();
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

  it("expands a firing alert row to show its firing instance with a silence action", async () => {
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

    const before = Date.now();
    const muteButton = screen.getByRole("button", { name: "Silence" });
    await user.click(muteButton);

    await waitFor(() => expect(createSilence).toHaveBeenCalledTimes(1));
    const call = createSilence.mock.calls[0]?.[0] as {
      data: {
        alertId: string;
        matchers: { label: string; op: string; value: string }[];
        endsAt: string;
        reason: string;
      };
    };
    // Rule-scoped: the server fn stamps the synthetic rule matcher itself, so
    // the client sends only the rule id plus the instance's labels as `=`
    // matchers (no synthetic matcher client-side).
    expect(call.data.alertId).toBe("rule-1");
    expect(call.data.matchers).toEqual([
      { label: "team", op: "=", value: "pay" },
    ]);
    expect(call.data.reason).toBe("Silenced from alerts list");
    const durationMs = new Date(call.data.endsAt).getTime() - before;
    expect(durationMs).toBeGreaterThanOrEqual(2 * 60 * 60 * 1000);
    expect(durationMs).toBeLessThan(2 * 60 * 60 * 1000 + 10_000);
  });

  it("does not offer expansion on non-firing rows", async () => {
    alertsData = [alertSummary({ currentState: "resolved" })];

    renderAlertsRoute(["/alerts"]);
    await screen.findByText("high-error-rate");

    expect(
      screen.queryByRole("button", { name: /expand firing detail/i }),
    ).not.toBeInTheDocument();
  });

  it("shows the silences pill and cancels an active silence from the panel", async () => {
    alertsData = [alertSummary()];
    ccSilencesData = [ccSilence()];
    const user = userEvent.setup();

    renderAlertsRoute(["/alerts"]);

    const pill = await screen.findByRole("button", {
      name: /1 silence active/i,
    });
    await user.click(pill);

    const panel = await screen.findByText("Active silences");
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
        screen.queryByRole("button", { name: /silence active/i }),
      ).not.toBeInTheDocument(),
    );
  });

  it("renders the silences control as a quiet outline button when no silences are active", async () => {
    alertsData = [alertSummary()];
    ccSilencesData = [];

    renderAlertsRoute(["/alerts"]);
    await screen.findByText("high-error-rate");

    expect(
      await screen.findByRole("button", { name: "Silences" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /silence active/i }),
    ).not.toBeInTheDocument();
  });

  describe("New silence dialog", () => {
    async function openNewMuteDialog(user: ReturnType<typeof userEvent.setup>) {
      const pill = await screen.findByRole("button", {
        name: /^silences$|silence active/i,
      });
      await user.click(pill);
      await user.click(
        await screen.findByRole("button", { name: "New silence" }),
      );
      expect(await screen.findByText("New silence")).toBeInTheDocument();
    }

    it("disables Create silence until at least one matcher is set, then creates it with the built matchers and window", async () => {
      alertsData = [alertSummary()];
      const user = userEvent.setup();

      renderAlertsRoute(["/alerts"]);
      await screen.findByText("high-error-rate");
      await openNewMuteDialog(user);

      const createButton = screen.getByRole("button", {
        name: /create silence/i,
      });
      expect(createButton).toBeDisabled();

      await user.click(screen.getByRole("button", { name: "Add" }));
      await user.type(screen.getByLabelText("Matcher label"), "namespace");
      // Label alone is not a complete matcher: a blank-value row would be an
      // accidentally-broad org-wide silence (blank-value `ne` matches nearly
      // everything), so Create must stay disabled until the value is filled.
      expect(createButton).toBeDisabled();

      await user.type(screen.getByLabelText("Matcher value"), "staging");

      expect(createButton).toBeEnabled();

      await user.click(screen.getByRole("button", { name: "8h" }));
      await user.type(screen.getByLabelText(/reason/i), "Muting before deploy");

      const before = Date.now();
      await user.click(createButton);

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
        { label: "namespace", op: "eq", value: "staging" },
      ]);
      expect(call.data.comment).toBe("Muting before deploy");
      const durationMs = new Date(call.data.ends_at).getTime() - before;
      expect(durationMs).toBeGreaterThanOrEqual(8 * 60 * 60 * 1000 - 5_000);
      expect(durationMs).toBeLessThan(8 * 60 * 60 * 1000 + 10_000);

      await waitFor(() =>
        expect(screen.queryByText("New silence")).not.toBeInTheDocument(),
      );
    });

    it("never calls createCcSilence with zero matchers", async () => {
      alertsData = [alertSummary()];
      const user = userEvent.setup();

      renderAlertsRoute(["/alerts"]);
      await screen.findByText("high-error-rate");
      await openNewMuteDialog(user);

      await user.click(screen.getByRole("button", { name: /create silence/i }));

      expect(createCcSilence).not.toHaveBeenCalled();
    });
  });

  it("shows a health dot per rule, amber and detailed when degraded", async () => {
    alertsData = [
      alertSummary({ id: "rule-1", slug: "healthy-rule" }),
      alertSummary({
        id: "rule-2",
        slug: "degraded-rule",
        displayName: "Degraded rule",
        health: "degraded",
        healthError: "boom",
        healthConsecutiveFailures: 3,
        healthLastErrorAt: "2026-07-05T00:00:00.000Z",
        lastSeenAt: "2026-07-05T00:00:00.000Z",
        evaluationIntervalSeconds: 60,
      }),
    ];

    renderAlertsRoute(["/alerts"]);
    await screen.findByText("healthy-rule");

    // The degraded rule's dot carries the diagnostic detail in its tooltip:
    // failure streak, last error, when it last FAILED (CC stamps last_error_at
    // on every failed attempt — lastSeenAt freezes during a degraded streak so
    // it must not be presented as evaluation recency), and cadence.
    const degradedDot = screen.getByTitle(/3 consecutive failures/i);
    expect(degradedDot.title).toMatch(/boom/i);
    expect(degradedDot.title).toMatch(/last failed/i);
    expect(degradedDot.title).toMatch(/checks every 1m/i);
    expect(degradedDot.title).not.toMatch(/last evaluated|last active/i);

    // The healthy rule's dot stays calm: recency labeled honestly as activity
    // (lastSeenAt only advances when the query returns rows), no failure detail.
    const healthyDot = screen.getByTitle(/^healthy/i);
    expect(healthyDot.title).toMatch(/last active/i);
    expect(healthyDot.title).not.toMatch(/consecutive failures/i);
  });

  it("hides the Degraded filter chip when every rule is healthy", async () => {
    alertsData = [alertSummary({ id: "rule-1", slug: "healthy-rule" })];

    renderAlertsRoute(["/alerts"]);
    await screen.findByText("healthy-rule");

    // All rules healthy: the default view stays calm, no Degraded chip.
    expect(
      screen.queryByRole("button", { name: /Degraded/ }),
    ).not.toBeInTheDocument();
  });

  it("shows a Degraded filter chip that filters to degraded rules", async () => {
    alertsData = [
      alertSummary({ id: "rule-1", slug: "healthy-rule" }),
      alertSummary({
        id: "rule-2",
        slug: "degraded-rule",
        health: "degraded",
        healthError: "boom",
        healthConsecutiveFailures: 2,
      }),
    ];
    const user = userEvent.setup();

    renderAlertsRoute(["/alerts"]);
    await screen.findByText("healthy-rule");

    const chip = await screen.findByRole("button", { name: /Degraded/ });
    expect(within(chip).getByText("1")).toBeInTheDocument();

    await user.click(chip);
    expect(await screen.findByText("degraded-rule")).toBeInTheDocument();
    expect(screen.queryByText("healthy-rule")).not.toBeInTheDocument();
  });

  it("shows checks-every and last-active facts in the expanded firing row", async () => {
    alertsData = [
      alertSummary({
        currentState: "firing",
        lastFiredAt: "2026-07-05T00:00:00.000Z",
        firingInstanceCount: 1,
        evaluationIntervalSeconds: 300,
        lastSeenAt: "2026-07-05T00:00:00.000Z",
      }),
    ];
    ccAlertsData = [ccAlert()];
    const user = userEvent.setup();

    renderAlertsRoute(["/alerts"]);
    await screen.findByText("high-error-rate");

    await user.click(
      screen.getByRole("button", { name: /expand firing detail/i }),
    );

    expect(await screen.findByText(/checks every 5m/i)).toBeInTheDocument();
    expect(screen.getByText(/last active/i)).toBeInTheDocument();
  });

  it("renders 'silence' vocabulary in the alerts home", async () => {
    alertsData = [
      alertSummary({
        currentState: "firing",
        lastFiredAt: "2026-07-05T00:00:00.000Z",
        firingInstanceCount: 1,
      }),
      alertSummary({
        id: "rule-2",
        slug: "noisy-rule",
        displayName: "Noisy rule",
        activeSilenceCount: 1,
      }),
    ];
    ccAlertsData = [ccAlert()];
    ccSilencesData = [ccSilence()];

    renderAlertsRoute(["/alerts"]);

    await screen.findByText("high-error-rate");
    await screen.findByRole("button", { name: /1 silence active/i });
    // The state badge (rendered from the rule with an active silence) and the
    // filter chip both use the "silenced"/"Silenced" vocabulary.
    expect(screen.getByText("silenced")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Silenced/ }),
    ).toBeInTheDocument();
    // The retired "mute" noun vocabulary must not linger anywhere on the page.
    expect(document.body.textContent?.toLowerCase()).not.toContain("mute");
  });

  describe("flat firing view toggle", () => {
    it("stays hidden when the Firing chip isn't the active filter", async () => {
      alertsData = [
        alertSummary({
          currentState: "firing",
          lastFiredAt: "2026-07-05T00:00:00.000Z",
          firingInstanceCount: 1,
        }),
      ];
      ccAlertsData = [ccAlert()];

      renderAlertsRoute(["/alerts"]);
      await screen.findByText("high-error-rate");

      expect(
        screen.queryByRole("tab", { name: "Flat" }),
      ).not.toBeInTheDocument();
    });

    it("stays hidden when Firing is active but no instance is reported", async () => {
      alertsData = [
        alertSummary({
          currentState: "firing",
          lastFiredAt: "2026-07-05T00:00:00.000Z",
          firingInstanceCount: 1,
        }),
      ];
      ccAlertsData = [];
      const user = userEvent.setup();

      renderAlertsRoute(["/alerts"]);
      await screen.findByText("high-error-rate");
      await user.click(screen.getByRole("button", { name: /Firing/ }));

      expect(
        screen.queryByRole("tab", { name: "Flat" }),
      ).not.toBeInTheDocument();
    });

    it("shows the toggle once Firing is active with an instance, and switching to Flat renders one row per label set with resolved Notifies text", async () => {
      alertsData = [
        alertSummary({
          currentState: "firing",
          lastFiredAt: "2026-07-05T00:00:00.000Z",
          firingInstanceCount: 2,
        }),
      ];
      ccAlertsData = [
        ccAlert({
          key: "rule-1|team=pay",
          labels: { team: "pay" },
          value: 42,
        }),
        ccAlert({
          key: "rule-1|team=core",
          labels: { team: "core" },
          value: 7,
        }),
      ];
      ccRoutesData = [
        ccRoute({
          id: "custom",
          receiver: "oncall",
          matchers: [{ label: "team", op: "eq", value: "pay" }],
        }),
      ];
      const user = userEvent.setup();

      renderAlertsRoute(["/alerts"]);
      await screen.findByText("high-error-rate");
      await user.click(screen.getByRole("button", { name: /Firing/ }));

      const toggle = await screen.findByRole("tab", { name: "Flat" });
      await user.click(toggle);

      const rows = await screen.findAllByRole("link", {
        name: "High error rate",
      });
      expect(rows).toHaveLength(2);
      expect(screen.getByText("pay")).toBeInTheDocument();
      expect(screen.getByText("core")).toBeInTheDocument();
      expect(screen.getByText("oncall")).toBeInTheDocument();
      expect(
        screen.getAllByText("No receivers configured").length,
      ).toBeGreaterThan(0);

      // Group mode stays the default and unaffected: switching back shows the
      // existing grouped/expandable row instead of the flat table.
      await user.click(screen.getByRole("tab", { name: "Group by alert" }));
      expect(
        screen.getByRole("button", { name: /expand firing detail/i }),
      ).toBeInTheDocument();
    });

    it("shows a silenced indicator for a row an active silence matches", async () => {
      alertsData = [
        alertSummary({
          currentState: "firing",
          lastFiredAt: "2026-07-05T00:00:00.000Z",
          firingInstanceCount: 1,
        }),
      ];
      ccAlertsData = [ccAlert({ labels: { team: "pay" } })];
      ccSilencesData = [
        ccSilence({ matchers: [{ label: "team", op: "eq", value: "pay" }] }),
      ];
      const user = userEvent.setup();

      renderAlertsRoute(["/alerts"]);
      await screen.findByText("high-error-rate");
      await user.click(screen.getByRole("button", { name: /Firing/ }));
      await user.click(await screen.findByRole("tab", { name: "Flat" }));

      expect(await screen.findByText("silenced")).toBeInTheDocument();
    });

    it("scopes a rule-scoped silence's label matchers to the matching label set only", async () => {
      alertsData = [
        alertSummary({
          currentState: "firing",
          lastFiredAt: "2026-07-05T00:00:00.000Z",
          firingInstanceCount: 2,
        }),
      ];
      ccAlertsData = [
        ccAlert({ key: "rule-1|team=pay", labels: { team: "pay" } }),
        ccAlert({ key: "rule-1|team=core", labels: { team: "core" } }),
      ];
      // A silence created from this app's silence actions: the synthetic
      // RULE_LABEL matcher rides ALONGSIDE the instance's label matchers. It
      // must badge only the label set it was created from, not every set of
      // the rule.
      ccSilencesData = [
        ccSilence({
          matchers: [
            { label: "rule", op: "eq", value: "rule-1" },
            { label: "team", op: "eq", value: "pay" },
          ],
        }),
      ];
      const user = userEvent.setup();

      renderAlertsRoute(["/alerts"]);
      await screen.findByText("high-error-rate");
      await user.click(screen.getByRole("button", { name: /Firing/ }));
      await user.click(await screen.findByRole("tab", { name: "Flat" }));

      const payRow = (await screen.findByText("pay")).closest("tr");
      const coreRow = screen.getByText("core").closest("tr");
      expect(payRow).not.toBeNull();
      expect(coreRow).not.toBeNull();
      expect(
        within(payRow as HTMLElement).getByText("silenced"),
      ).toBeInTheDocument();
      expect(
        within(coreRow as HTMLElement).queryByText("silenced"),
      ).not.toBeInTheDocument();
    });

    it("applies the search box to flat rows and reflects them in the summary", async () => {
      alertsData = [
        alertSummary({
          currentState: "firing",
          lastFiredAt: "2026-07-05T00:00:00.000Z",
          firingInstanceCount: 2,
        }),
      ];
      ccAlertsData = [
        ccAlert({ key: "rule-1|team=pay", labels: { team: "pay" } }),
        ccAlert({ key: "rule-1|team=core", labels: { team: "core" } }),
      ];
      const user = userEvent.setup();

      renderAlertsRoute(["/alerts"]);
      await screen.findByText("high-error-rate");
      await user.click(screen.getByRole("button", { name: /Firing/ }));
      await user.click(await screen.findByRole("tab", { name: "Flat" }));

      expect(
        await screen.findAllByRole("link", { name: "High error rate" }),
      ).toHaveLength(2);

      await user.type(screen.getByLabelText("Search alerts"), "core");

      expect(
        screen.getAllByRole("link", { name: "High error rate" }),
      ).toHaveLength(1);
      expect(screen.getByText("core")).toBeInTheDocument();
      expect(screen.queryByText("pay")).not.toBeInTheDocument();
      expect(screen.getByText("Showing 1 of 2")).toBeInTheDocument();
    });
  });
});
