import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  CcInhibition,
  CcReceiver,
  CcRoute,
  CcSubscription,
} from "@/data/cc/types";
import { Route as NotificationsFileRoute } from "./alerts_.notifications";

// ---------------------------------------------------------------------------
// Mocks, at the same module boundaries as
// src/routes/_authenticated/_dashboard/_previewable/alerts.test.tsx (itself
// following the _explore/errors.test.tsx idiom): the data modules the route
// talks to, built with `vi.hoisted` so the `vi.mock` factories (hoisted above
// these declarations) can reference them safely.
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({
  // listAlerts/createSilence: unused by this page, but stubbed because
  // "./alerts_.notifications" imports `alertSettingsQueryOptions` from the
  // alerts list route module, which also imports these from the same
  // mocked "@/data/alerts/server" module.
  listAlerts: vi.fn(),
  createSilence: vi.fn(),
  getAlertSettings: vi.fn(),
  updateAlertSettings: vi.fn(),
  listCcRoutes: vi.fn(),
  listCcReceivers: vi.fn(),
  listCcInhibitions: vi.fn(),
  listCcSubscriptions: vi.fn(),
  listCcAlerts: vi.fn(),
  listCcSilences: vi.fn(),
  // deleteCcSilence: likewise unused here, stubbed for the same reason.
  deleteCcSilence: vi.fn(),
  createCcRoute: vi.fn(),
  updateCcRoute: vi.fn(),
  deleteCcRoute: vi.fn(),
  createCcInhibition: vi.fn(),
  deleteCcInhibition: vi.fn(),
  createCcSubscription: vi.fn(),
  deleteCcSubscription: vi.fn(),
}));

vi.mock("@/data/alerts/server", () => ({
  listAlerts: mocks.listAlerts,
  createSilence: mocks.createSilence,
  getAlertSettings: mocks.getAlertSettings,
  updateAlertSettings: mocks.updateAlertSettings,
  RULE_LABEL: "rule",
}));

vi.mock("@/data/cc/server", () => ({
  listCcRoutes: mocks.listCcRoutes,
  listCcReceivers: mocks.listCcReceivers,
  listCcInhibitions: mocks.listCcInhibitions,
  listCcSubscriptions: mocks.listCcSubscriptions,
  listCcAlerts: mocks.listCcAlerts,
  listCcSilences: mocks.listCcSilences,
  deleteCcSilence: mocks.deleteCcSilence,
  createCcRoute: mocks.createCcRoute,
  updateCcRoute: mocks.updateCcRoute,
  deleteCcRoute: mocks.deleteCcRoute,
  createCcInhibition: mocks.createCcInhibition,
  deleteCcInhibition: mocks.deleteCcInhibition,
  createCcSubscription: mocks.createCcSubscription,
  deleteCcSubscription: mocks.deleteCcSubscription,
}));

const {
  getAlertSettings,
  updateAlertSettings,
  listCcRoutes,
  listCcReceivers,
  listCcInhibitions,
  listCcSubscriptions,
  listCcAlerts,
  listCcSilences,
} = mocks;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const defaultDelivery = {
  email: { enabled: false, to: [] },
  telegram: { enabled: false, botToken: "", chatIds: [] },
  slack: { enabled: false, webhookUrl: "" },
  remindEverySeconds: null,
};

function ccReceiver(overrides: Partial<CcReceiver> = {}): CcReceiver {
  return {
    id: "recv-1",
    tenant: "t1",
    name: "oncall",
    channel: { type: "pagerduty", routing_key: "key" },
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

let deliveryData = defaultDelivery;
let routesData: CcRoute[] = [];
let receiversData: CcReceiver[] = [];
let inhibitionsData: CcInhibition[] = [];
let subscriptionsData: CcSubscription[] = [];

mocks.getAlertSettings.mockImplementation(() =>
  Promise.resolve({ delivery: deliveryData }),
);
mocks.updateAlertSettings.mockImplementation(() =>
  Promise.resolve({ delivery: deliveryData }),
);
mocks.listCcRoutes.mockImplementation(() => Promise.resolve(routesData));
mocks.listCcReceivers.mockImplementation(() => Promise.resolve(receiversData));
mocks.listCcInhibitions.mockImplementation(() =>
  Promise.resolve(inhibitionsData),
);
mocks.listCcSubscriptions.mockImplementation(() =>
  Promise.resolve(subscriptionsData),
);
mocks.listCcAlerts.mockImplementation(() => Promise.resolve([]));
mocks.listCcSilences.mockImplementation(() => Promise.resolve([]));

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

function renderNotificationsRoute() {
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
  // The real route's `loader` prefetches via the app's `RouterContext`, which
  // this ad hoc tree doesn't provide — the component's own `useQuery` calls
  // fetch (via the mocked data modules) regardless, so the loader is skipped
  // here rather than fought into an unrelated fake context type.
  const notificationsRoute = createRoute({
    getParentRoute: () => dashboardRoute,
    path: "alerts/notifications",
    component: NotificationsFileRoute.options.component,
  });

  const routeTree = rootRoute.addChildren([
    authenticatedRoute.addChildren([
      dashboardRoute.addChildren([notificationsRoute]),
    ]),
  ]);

  const history = createMemoryHistory({
    initialEntries: ["/alerts/notifications"],
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

function cardTitles(): string[] {
  return Array.from(document.querySelectorAll('[data-slot="card-title"]')).map(
    (el) => el.textContent ?? "",
  );
}

describe("/alerts/notifications route", () => {
  beforeEach(() => {
    deliveryData = defaultDelivery;
    routesData = [];
    receiversData = [];
    inhibitionsData = [];
    subscriptionsData = [];
    getAlertSettings.mockClear();
    updateAlertSettings.mockClear();
    listCcRoutes.mockClear();
    listCcReceivers.mockClear();
    listCcInhibitions.mockClear();
    listCcSubscriptions.mockClear();
    listCcAlerts.mockClear();
    listCcSilences.mockClear();
  });

  it("renders the three layered sections in order, with Advanced collapsed", async () => {
    renderNotificationsRoute();

    await screen.findByText("Where alerts go");
    // Sections 1-2 are expanded by default; wait for their async content.
    await screen.findByText("Email");
    await screen.findByText("No custom notification rules");

    expect(cardTitles()).toEqual([
      "Where alerts go",
      "Custom notification rules",
      "Advanced",
    ]);
    expect(screen.getByText("Remind every")).toBeInTheDocument();

    // Advanced is collapsed: its content isn't mounted.
    expect(screen.queryByText("Dependency mutes")).not.toBeInTheDocument();
    expect(screen.queryByText("Webhook feed")).not.toBeInTheDocument();
    expect(screen.queryByText("Channels")).not.toBeInTheDocument();
  });

  it("expands Advanced to reveal the pipeline, mutes, webhook feed, and channels", async () => {
    receiversData = [ccReceiver()];
    const user = userEvent.setup();

    renderNotificationsRoute();
    await screen.findByText("Where alerts go");

    await user.click(screen.getByRole("button", { name: /Advanced/i }));

    expect(await screen.findByText("Dependency mutes")).toBeInTheDocument();
    expect(screen.getByText("Webhook feed")).toBeInTheDocument();
    expect(screen.getByText("Channels")).toBeInTheDocument();
  });

  it("renders a non-managed rule's sentence via matchersPhrase and excludes managed catch-all routes", async () => {
    routesData = [
      // Managed catch-all: empty matchers targeting a managed receiver — must
      // not show up as a custom rule.
      ccRoute({
        id: "catch-all-email",
        matchers: [],
        receiver: "everr-default-email",
        priority: 1000,
      }),
      // Custom rule.
      ccRoute({
        id: "route-critical",
        matchers: [{ label: "severity", op: "eq", value: "critical" }],
        receiver: "oncall",
        priority: 0,
      }),
    ];
    receiversData = [
      ccReceiver({
        name: "oncall",
        channel: { type: "pagerduty", routing_key: "k" },
      }),
    ];

    renderNotificationsRoute();

    expect(
      await screen.findByText(
        "When severity = critical, also notify oncall (PagerDuty).",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/everr-default-email/)).not.toBeInTheDocument();
  });

  it("saves the settings form via updateAlertSettings with the expected payload", async () => {
    const user = userEvent.setup();
    renderNotificationsRoute();

    await screen.findByText("Where alerts go");
    await screen.findByText("Email");

    const emailSwitch = screen.getByRole("switch", { name: /Email/i });
    await user.click(emailSwitch);
    const emailInput = screen.getByRole("textbox", {
      name: "Email recipients",
    });
    await user.type(emailInput, "team@example.com{enter}");

    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(updateAlertSettings).toHaveBeenCalledTimes(1));
    const call = updateAlertSettings.mock.calls[0]?.[0] as {
      data: { delivery: typeof defaultDelivery };
    };
    expect(call.data.delivery).toEqual({
      email: { enabled: true, to: ["team@example.com"] },
      telegram: { enabled: false, botToken: "", chatIds: [] },
      slack: { enabled: false, webhookUrl: "" },
      remindEverySeconds: null,
    });
  });

  it("never renders receiver/matcher/inhibition/firehose/silence/Clickety-Clack vocabulary by default", async () => {
    routesData = [
      ccRoute({
        id: "route-critical",
        matchers: [{ label: "severity", op: "eq", value: "critical" }],
        receiver: "oncall",
        priority: 0,
      }),
    ];
    receiversData = [ccReceiver()];

    renderNotificationsRoute();
    await screen.findByText("Where alerts go");
    await screen.findByText(/also notify oncall/);

    const text = document.body.textContent?.toLowerCase() ?? "";
    for (const banned of [
      "receiver",
      "matcher",
      "inhibition",
      "firehose",
      "silence",
      "clickety-clack",
    ]) {
      expect(text).not.toContain(banned);
    }
  });
});
