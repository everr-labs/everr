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
  AlertingChannel,
  AlertingReceiver,
  AlertingRoute,
  AlertingRuleView,
} from "@/data/alerting/types";
import { Route as RoutingFileRoute } from "./routing";

const mocks = vi.hoisted(() => ({
  listAlertingRoutes: vi.fn(),
  listAlertingReceivers: vi.fn(),
  listAlertingChannels: vi.fn(),
  listAlertingInhibitions: vi.fn(),
  listAlertingAlerts: vi.fn(),
  listAlertingRules: vi.fn(),
  listAlertingLabelKeys: vi.fn(),
  listAlertingLabelValues: vi.fn(),
  createAlertingRoute: vi.fn(),
  updateAlertingRoute: vi.fn(),
  deleteAlertingRoute: vi.fn(),
  createAlertingInhibition: vi.fn(),
  deleteAlertingInhibition: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("@/data/alerting/delivery/server", () => ({
  listAlertingRoutes: mocks.listAlertingRoutes,
  listAlertingReceivers: mocks.listAlertingReceivers,
  listAlertingChannels: mocks.listAlertingChannels,
  listAlertingInhibitions: mocks.listAlertingInhibitions,
  createAlertingRoute: mocks.createAlertingRoute,
  updateAlertingRoute: mocks.updateAlertingRoute,
  deleteAlertingRoute: mocks.deleteAlertingRoute,
  createAlertingInhibition: mocks.createAlertingInhibition,
  deleteAlertingInhibition: mocks.deleteAlertingInhibition,
}));

vi.mock("@/data/alerting/instances/server", () => ({
  listAlertingAlerts: mocks.listAlertingAlerts,
}));

vi.mock("@/data/alerting/rules/server", () => ({
  listAlertingRules: mocks.listAlertingRules,
}));

vi.mock("@/data/alerting/routing/suggestions", () => ({
  listAlertingLabelKeys: mocks.listAlertingLabelKeys,
  listAlertingLabelValues: mocks.listAlertingLabelValues,
}));

vi.mock("sonner", () => ({
  toast: {
    success: (...a: unknown[]) => mocks.toastSuccess(...a),
    error: (...a: unknown[]) => mocks.toastError(...a),
  },
}));

function receiver(overrides: Partial<AlertingReceiver> = {}): AlertingReceiver {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    tenant: "org1",
    name: "oncall",
    channels: ["oncall-hook"],
    ...overrides,
  };
}

function channel(overrides: Partial<AlertingChannel> = {}): AlertingChannel {
  return {
    id: "22222222-2222-2222-2222-222222222222",
    tenant: "org1",
    name: "oncall-hook",
    config: { type: "webhook", url: "https://example.com/hook" },
    ...overrides,
  };
}

function route(overrides: Partial<AlertingRoute> = {}): AlertingRoute {
  return {
    id: "33333333-3333-3333-3333-333333333333",
    tenant: "org1",
    matchers: [{ label: "severity", op: "eq", value: "critical" }],
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

function renderRoutingPage() {
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
  const routingRoute = createRoute({
    getParentRoute: () => dashboardRoute,
    path: "alerts/routing",
    component: RoutingFileRoute.options.component,
  });
  // Destination of the two crossing callbacks. A stub is enough: these tests
  // only check where the router lands, not what the Notifications page does.
  const notificationsRoute = createRoute({
    getParentRoute: () => dashboardRoute,
    path: "alerts/notifications",
    component: () => null,
  });

  const routeTree = rootRoute.addChildren([
    authenticatedRoute.addChildren([
      dashboardRoute.addChildren([routingRoute, notificationsRoute]),
    ]),
  ]);

  const history = createMemoryHistory({ initialEntries: ["/alerts/routing"] });
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
  vi.clearAllMocks();
  mocks.listAlertingRoutes.mockResolvedValue([]);
  mocks.listAlertingReceivers.mockResolvedValue([]);
  mocks.listAlertingChannels.mockResolvedValue([]);
  mocks.listAlertingInhibitions.mockResolvedValue([]);
  mocks.listAlertingAlerts.mockResolvedValue([]);
  mocks.listAlertingRules.mockResolvedValue([]);
  mocks.listAlertingLabelKeys.mockResolvedValue([]);
  mocks.listAlertingLabelValues.mockResolvedValue([]);
});

describe("/alerts/routing inline route editor", () => {
  it("keeps an incomplete condition from being saved", async () => {
    const user = userEvent.setup();

    renderRoutingPage();

    await user.click(await screen.findByRole("button", { name: "New route" }));
    const editor = await screen.findByRole("listitem", {
      name: "Creating a new route",
    });

    await user.type(
      within(editor).getByLabelText("Send to receiver"),
      "oncall",
    );
    await user.click(
      within(editor).getByRole("button", { name: "Add matcher" }),
    );

    expect(
      within(editor).getByText(
        "Choose a label or remove the empty matcher before saving.",
      ),
    ).toBeVisible();
    expect(
      within(editor).getByRole("button", { name: "Create route" }),
    ).toBeDisabled();

    await user.click(
      within(editor).getByRole("button", { name: "Remove condition 1" }),
    );
    expect(
      within(editor).getByRole("button", { name: "Create route" }),
    ).toBeEnabled();
  });

  it("adds a suggested label to explicit grouping", async () => {
    mocks.listAlertingLabelKeys.mockResolvedValue([
      { key: "severity", synthetic: true },
      { key: "team", synthetic: false },
    ]);
    mocks.createAlertingRoute.mockResolvedValue(route({ group_by: ["team"] }));
    const user = userEvent.setup();

    renderRoutingPage();

    await user.click(await screen.findByRole("button", { name: "New route" }));
    const editor = await screen.findByRole("listitem", {
      name: "Creating a new route",
    });
    await user.type(
      within(editor).getByLabelText("Send to receiver"),
      "oncall",
    );
    await user.click(
      within(editor).getByRole("button", { name: /Notification timing/ }),
    );
    await user.click(
      within(editor).getByRole("combobox", { name: "Grouping" }),
    );
    await user.click(screen.getByRole("option", { name: /By labels/ }));
    await user.click(
      within(editor).getByRole("combobox", { name: "Group by labels" }),
    );
    await user.click(await screen.findByRole("option", { name: "team" }));
    await user.click(
      within(editor).getByRole("button", { name: "Create route" }),
    );

    await waitFor(() =>
      expect(mocks.createAlertingRoute).toHaveBeenCalledWith({
        data: expect.objectContaining({
          group_by: ["rule", "severity", "team"],
        }),
      }),
    );
  });

  it("saves one notification group as an explicit empty label list", async () => {
    mocks.createAlertingRoute.mockResolvedValue(route({ group_by: [] }));
    const user = userEvent.setup();

    renderRoutingPage();

    await user.click(await screen.findByRole("button", { name: "New route" }));
    const editor = await screen.findByRole("listitem", {
      name: "Creating a new route",
    });
    await user.type(
      within(editor).getByLabelText("Send to receiver"),
      "oncall",
    );
    await user.click(
      within(editor).getByRole("button", { name: /Notification timing/ }),
    );
    await user.click(
      within(editor).getByRole("combobox", { name: "Grouping" }),
    );
    await user.click(screen.getByRole("option", { name: /One group/ }));
    expect(
      within(editor).getByRole("button", { name: /one group/ }),
    ).toBeVisible();
    await user.click(
      within(editor).getByRole("button", { name: "Create route" }),
    );

    await waitFor(() =>
      expect(mocks.createAlertingRoute).toHaveBeenCalledWith({
        data: expect.objectContaining({ group_by: [] }),
      }),
    );
  });

  it("creates a route with the unchanged payload shape and null timing defaults", async () => {
    mocks.createAlertingRoute.mockResolvedValue(route());
    const user = userEvent.setup();

    renderRoutingPage();

    await user.click(await screen.findByRole("button", { name: "New route" }));
    const editor = await screen.findByRole("listitem", {
      name: "Creating a new route",
    });

    await user.type(
      within(editor).getByLabelText("Send to receiver"),
      "oncall",
    );
    await user.click(
      within(editor).getByRole("button", { name: "Create route" }),
    );

    await waitFor(() =>
      expect(mocks.createAlertingRoute).toHaveBeenCalledWith({
        data: {
          matchers: [],
          receiver: "oncall",
          continue: false,
          priority: 0,
          group_by: null,
          group_wait_secs: null,
          group_interval_secs: null,
          repeat_interval_secs: null,
        },
      }),
    );
  });

  it("edits a route in place while keeping the rest of the pipeline visible", async () => {
    const first = route();
    const second = route({
      id: "44444444-4444-4444-4444-444444444444",
      priority: 10,
      matchers: [{ label: "severity", op: "eq", value: "warning" }],
    });
    mocks.listAlertingRoutes.mockResolvedValue([first, second]);
    mocks.listAlertingReceivers.mockResolvedValue([receiver()]);
    mocks.listAlertingChannels.mockResolvedValue([channel()]);
    mocks.updateAlertingRoute.mockResolvedValue({ ...first, continue: true });
    const user = userEvent.setup();

    renderRoutingPage();

    await user.click(
      await screen.findByRole("button", { name: "Edit route 1" }),
    );
    const editor = screen.getByRole("listitem", { name: "Editing route 1" });
    expect(screen.getByTitle("Route 2 of 2")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New route" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Edit route 2" })).toBeDisabled();

    await user.click(
      within(editor).getByRole("switch", {
        name: "Continue matching later routes",
      }),
    );
    await user.click(
      within(editor).getByRole("button", { name: "Save changes" }),
    );

    await waitFor(() =>
      expect(mocks.updateAlertingRoute).toHaveBeenCalledWith({
        data: {
          id: first.id,
          input: {
            matchers: first.matchers,
            receiver: first.receiver,
            continue: true,
            priority: first.priority,
            group_by: null,
            group_wait_secs: null,
            group_interval_secs: null,
            repeat_interval_secs: null,
          },
        },
      }),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Edit route 1" }),
      ).toHaveFocus(),
    );
  });

  it("inserts a route from the separator and preserves its selected position", async () => {
    const first = route();
    const second = route({
      id: "44444444-4444-4444-4444-444444444444",
      priority: 10,
      matchers: [{ label: "severity", op: "eq", value: "warning" }],
    });
    const inserted = route({
      id: "55555555-5555-5555-5555-555555555555",
      priority: 10,
      matchers: [],
    });
    mocks.listAlertingRoutes.mockResolvedValue([first, second]);
    mocks.updateAlertingRoute.mockResolvedValue({ ...second, priority: 20 });
    mocks.createAlertingRoute.mockResolvedValue(inserted);
    const user = userEvent.setup();

    renderRoutingPage();

    await user.click(
      await screen.findByRole("button", {
        name: "Add route between 1 and 2",
      }),
    );
    const editor = screen.getByRole("listitem", {
      name: "Creating a new route",
    });
    expect(editor).not.toHaveTextContent("This becomes route");
    expect(screen.getByTitle("Route 3 of 3")).toBeInTheDocument();

    await user.type(
      within(editor).getByLabelText("Send to receiver"),
      "oncall",
    );
    await user.click(
      within(editor).getByRole("button", { name: "Create route" }),
    );

    await waitFor(() =>
      expect(mocks.updateAlertingRoute).toHaveBeenCalledTimes(1),
    );
    expect(mocks.updateAlertingRoute).toHaveBeenCalledWith({
      data: {
        id: second.id,
        input: expect.objectContaining({
          matchers: second.matchers,
          receiver: second.receiver,
          priority: 20,
        }),
      },
    });
    await waitFor(() =>
      expect(mocks.createAlertingRoute).toHaveBeenCalledWith({
        data: {
          matchers: [],
          receiver: "oncall",
          continue: false,
          priority: 10,
          group_by: null,
          group_wait_secs: null,
          group_interval_secs: null,
          repeat_interval_secs: null,
        },
      }),
    );
  });
});

describe("/alerts/routing setup checklist", () => {
  it("shows every setup step for a fresh org, and opens the route builder from it", async () => {
    const user = userEvent.setup();
    renderRoutingPage();

    await screen.findByText("Set up delivery");
    expect(screen.getByRole("button", { name: "Add channel" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Add receiver" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Add route" })).toBeVisible();

    // The route step still opens its editor in place: only the channel and
    // receiver steps became cross-page navigations.
    await user.click(screen.getByRole("button", { name: "Add route" }));
    expect(
      screen.getByRole("listitem", { name: "Creating a new route" }),
    ).toBeInTheDocument();
  });

  it("marks completed steps and keeps only the missing ones actionable", async () => {
    mocks.listAlertingChannels.mockResolvedValue([channel()]);
    mocks.listAlertingReceivers.mockResolvedValue([receiver()]);

    renderRoutingPage();

    await screen.findByText("Set up delivery");
    expect(
      screen.queryByRole("button", { name: "Add channel" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Add receiver" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add route" })).toBeVisible();
  });

  it("disappears once a route exists", async () => {
    mocks.listAlertingRoutes.mockResolvedValue([route()]);

    renderRoutingPage();

    await screen.findByText("no match");
    expect(screen.queryByText("Set up delivery")).not.toBeInTheDocument();
  });

  it("sends the reader to notifications to add a channel", async () => {
    const user = userEvent.setup();

    const { router } = renderRoutingPage();

    await user.click(
      await screen.findByRole("button", { name: "Add channel" }),
    );
    await waitFor(() =>
      expect(router.state.location.pathname).toBe("/alerts/notifications"),
    );
    expect(router.state.location.search).toEqual({ new: "channel" });
  });

  it("sends the reader to notifications to add a receiver", async () => {
    const user = userEvent.setup();

    const { router } = renderRoutingPage();

    await user.click(
      await screen.findByRole("button", { name: "Add receiver" }),
    );
    await waitFor(() =>
      expect(router.state.location.pathname).toBe("/alerts/notifications"),
    );
    expect(router.state.location.search).toEqual({ new: "receiver" });
  });
});

describe("/alerts/routing pipeline fall-through", () => {
  it("with zero routes, says alerts are not delivered", async () => {
    renderRoutingPage();

    const row = await screen.findByText("no match");
    expect(row.parentElement).toHaveTextContent("not delivered");
    expect(row.parentElement).toHaveTextContent("catch-all");
  });

  it("with routes and no catch-all, says unmatched alerts are not delivered", async () => {
    mocks.listAlertingRoutes.mockResolvedValue([route()]);

    renderRoutingPage();

    const row = await screen.findByText("no match");
    expect(row.parentElement).toHaveTextContent("not delivered");
    expect(row.parentElement).toHaveTextContent("catch-all");
  });

  it("with a catch-all route, hides the fall-through row entirely", async () => {
    mocks.listAlertingRoutes.mockResolvedValue([
      route(),
      route({ id: "44444444-4444-4444-4444-444444444444", matchers: [] }),
    ]);

    renderRoutingPage();

    await screen.findByText("any alert");
    expect(screen.queryByText("no match")).not.toBeInTheDocument();
  });
});

describe("/alerts/routing route safety", () => {
  it("moves routes directly and normalizes their priorities", async () => {
    const first = route();
    const second = route({
      id: "44444444-4444-4444-4444-444444444444",
      priority: 10,
      matchers: [{ label: "severity", op: "eq", value: "warning" }],
    });
    mocks.listAlertingRoutes.mockResolvedValue([first, second]);
    mocks.listAlertingReceivers.mockResolvedValue([receiver()]);
    mocks.listAlertingChannels.mockResolvedValue([channel()]);
    mocks.updateAlertingRoute.mockResolvedValue(second);
    const user = userEvent.setup();

    renderRoutingPage();

    await user.click(
      await screen.findByRole("button", { name: "Move route 2 up" }),
    );

    await waitFor(() =>
      expect(mocks.updateAlertingRoute).toHaveBeenCalledTimes(2),
    );
    expect(mocks.updateAlertingRoute).toHaveBeenNthCalledWith(1, {
      data: {
        id: second.id,
        input: expect.objectContaining({
          matchers: second.matchers,
          receiver: second.receiver,
          priority: 0,
        }),
      },
    });
    expect(mocks.updateAlertingRoute).toHaveBeenNthCalledWith(2, {
      data: {
        id: first.id,
        input: expect.objectContaining({
          matchers: first.matchers,
          receiver: first.receiver,
          priority: 10,
        }),
      },
    });
  });
});

describe("/alerts/routing matcher name resolution", () => {
  const RULE_ID = "44444444-4444-4444-4444-444444444444";

  function alertingRuleView(
    overrides: Partial<AlertingRuleView> = {},
  ): AlertingRuleView {
    return alertingRuleViewFixture({
      id: RULE_ID,
      spec: {
        interval_secs: 30,
        condition: { operator: "gt", threshold: 0 },
        severity: "info",
      },
      rollup: {
        alert_state: "inactive",
        firing_instance_count: 0,
        last_fired_at: null,
        last_resolved_at: null,
        last_seen_at: null,
        next_evaluation_at: "2026-06-14T12:01:00Z",
        last_row_count: null,
      },
      ...overrides,
    });
  }

  it("renders a rule matcher as the rule's linked name, keeping the id as the title", async () => {
    mocks.listAlertingRules.mockResolvedValue([alertingRuleView()]);
    mocks.listAlertingRoutes.mockResolvedValue([
      route({ matchers: [{ label: "rule", op: "eq", value: RULE_ID }] }),
    ]);
    mocks.listAlertingReceivers.mockResolvedValue([receiver()]);
    mocks.listAlertingChannels.mockResolvedValue([channel()]);

    renderRoutingPage();

    const link = await screen.findByRole("link", { name: "flapping" });
    expect(link).toHaveAttribute("title", RULE_ID);
    // The raw id never renders as text: it lives on the title only.
    expect(screen.queryByText(RULE_ID)).toBeNull();
  });

  it("keeps the raw value for matchers it cannot resolve", async () => {
    mocks.listAlertingRoutes.mockResolvedValue([
      route({ matchers: [{ label: "rule", op: "eq", value: RULE_ID }] }),
    ]);
    mocks.listAlertingReceivers.mockResolvedValue([receiver()]);
    mocks.listAlertingChannels.mockResolvedValue([channel()]);

    renderRoutingPage();

    expect(await screen.findByText(RULE_ID)).toBeInTheDocument();
  });
});
