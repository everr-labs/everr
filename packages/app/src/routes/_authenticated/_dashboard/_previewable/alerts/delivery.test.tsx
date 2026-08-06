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
import { Route as DeliveryFileRoute } from "./delivery";

const mocks = vi.hoisted(() => ({
  listAlertingRoutes: vi.fn(),
  listAlertingReceivers: vi.fn(),
  listAlertingChannels: vi.fn(),
  listAlertingInhibitions: vi.fn(),
  listAlertingAlerts: vi.fn(),
  listAlertingRules: vi.fn(),
  listAlertingSlos: vi.fn(),
  listAlertingLabelKeys: vi.fn(),
  listAlertingLabelValues: vi.fn(),
  createAlertingChannel: vi.fn(),
  updateAlertingChannel: vi.fn(),
  deleteAlertingChannel: vi.fn(),
  createAlertingReceiver: vi.fn(),
  updateAlertingReceiver: vi.fn(),
  deleteAlertingReceiver: vi.fn(),
  createAlertingRoute: vi.fn(),
  updateAlertingRoute: vi.fn(),
  deleteAlertingRoute: vi.fn(),
  createAlertingInhibition: vi.fn(),
  deleteAlertingInhibition: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("@/data/alerting/server", () => ({
  listAlertingRoutes: mocks.listAlertingRoutes,
  listAlertingReceivers: mocks.listAlertingReceivers,
  listAlertingChannels: mocks.listAlertingChannels,
  listAlertingInhibitions: mocks.listAlertingInhibitions,
  listAlertingAlerts: mocks.listAlertingAlerts,
  listAlertingRules: mocks.listAlertingRules,
  listAlertingSlos: mocks.listAlertingSlos,
  listAlertingLabelKeys: mocks.listAlertingLabelKeys,
  listAlertingLabelValues: mocks.listAlertingLabelValues,
  createAlertingChannel: mocks.createAlertingChannel,
  updateAlertingChannel: mocks.updateAlertingChannel,
  deleteAlertingChannel: mocks.deleteAlertingChannel,
  createAlertingReceiver: mocks.createAlertingReceiver,
  updateAlertingReceiver: mocks.updateAlertingReceiver,
  deleteAlertingReceiver: mocks.deleteAlertingReceiver,
  createAlertingRoute: mocks.createAlertingRoute,
  updateAlertingRoute: mocks.updateAlertingRoute,
  deleteAlertingRoute: mocks.deleteAlertingRoute,
  createAlertingInhibition: mocks.createAlertingInhibition,
  deleteAlertingInhibition: mocks.deleteAlertingInhibition,
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

function renderDeliveryRoute() {
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
  const deliveryRoute = createRoute({
    getParentRoute: () => dashboardRoute,
    path: "alerts/delivery",
    component: DeliveryFileRoute.options.component,
  });

  const routeTree = rootRoute.addChildren([
    authenticatedRoute.addChildren([
      dashboardRoute.addChildren([deliveryRoute]),
    ]),
  ]);

  const history = createMemoryHistory({ initialEntries: ["/alerts/delivery"] });
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

// Base UI moves initial focus into an opened dialog asynchronously; typing
// before that settles can lose keystrokes to the focus trap. Always wait for
// focus to land inside the drawer before interacting with its fields.
async function findSettledDrawer() {
  const drawer = await screen.findByRole("dialog");
  await waitFor(() => {
    expect(drawer.contains(document.activeElement)).toBe(true);
  });
  return drawer;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.listAlertingRoutes.mockResolvedValue([]);
  mocks.listAlertingReceivers.mockResolvedValue([]);
  mocks.listAlertingChannels.mockResolvedValue([]);
  mocks.listAlertingInhibitions.mockResolvedValue([]);
  mocks.listAlertingAlerts.mockResolvedValue([]);
  mocks.listAlertingRules.mockResolvedValue([]);
  mocks.listAlertingSlos.mockResolvedValue([]);
  mocks.listAlertingLabelKeys.mockResolvedValue([]);
  mocks.listAlertingLabelValues.mockResolvedValue([]);
});

describe("/alerts/delivery inline route editor", () => {
  it("keeps an incomplete condition from being saved", async () => {
    const user = userEvent.setup();

    renderDeliveryRoute();

    await user.click(await screen.findByRole("button", { name: "New route" }));
    const editor = await screen.findByRole("listitem", {
      name: "Creating a new route",
    });

    await user.type(
      within(editor).getByLabelText("Send to receiver"),
      "oncall",
    );
    await user.click(
      within(editor).getByRole("button", { name: "Add condition" }),
    );

    expect(
      within(editor).getByText(
        "Choose a label or remove the empty condition before saving.",
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

    renderDeliveryRoute();

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

    renderDeliveryRoute();

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

    renderDeliveryRoute();

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

    renderDeliveryRoute();

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

    renderDeliveryRoute();

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

describe("/alerts/delivery setup checklist", () => {
  it("walks a fresh org from channel to receiver to route", async () => {
    const user = userEvent.setup();
    renderDeliveryRoute();

    await screen.findByText("Set up delivery");
    expect(screen.getByRole("button", { name: "Add receiver" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Add route" })).toBeVisible();

    // Step actions open the real create drawers, not just scroll somewhere.
    await user.click(screen.getByRole("button", { name: "Add channel" }));
    const drawer = await findSettledDrawer();
    expect(within(drawer).getByText("New channel")).toBeInTheDocument();
  });

  it("marks completed steps and keeps only the missing ones actionable", async () => {
    mocks.listAlertingChannels.mockResolvedValue([channel()]);
    mocks.listAlertingReceivers.mockResolvedValue([receiver()]);

    renderDeliveryRoute();

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

    renderDeliveryRoute();

    await screen.findByText("no match");
    expect(screen.queryByText("Set up delivery")).not.toBeInTheDocument();
  });
});

describe("/alerts/delivery usage facts", () => {
  it("warns about receivers no route targets and channels no receiver references", async () => {
    mocks.listAlertingReceivers.mockResolvedValue([receiver()]);
    mocks.listAlertingChannels.mockResolvedValue([
      channel(),
      channel({ id: "55555555-5555-5555-5555-555555555555", name: "spare" }),
    ]);

    renderDeliveryRoute();

    // receiver() exists but no route targets it; "spare" is in no receiver.
    expect(
      await screen.findByText("no route targets this receiver"),
    ).toBeInTheDocument();
    expect(
      await screen.findByText("not referenced by any receiver"),
    ).toBeInTheDocument();
    // "oncall-hook" IS referenced by the receiver.
    expect(await screen.findByText("1 receiver")).toBeInTheDocument();
  });

  it("counts the routes targeting a receiver", async () => {
    mocks.listAlertingRoutes.mockResolvedValue([route()]);
    mocks.listAlertingReceivers.mockResolvedValue([receiver()]);
    mocks.listAlertingChannels.mockResolvedValue([channel()]);

    renderDeliveryRoute();

    expect(await screen.findByText("1 route")).toBeInTheDocument();
    expect(
      screen.queryByText("no route targets this receiver"),
    ).not.toBeInTheDocument();
  });
});

describe("/alerts/delivery pipeline fall-through", () => {
  it("with zero routes, says alerts are not delivered", async () => {
    renderDeliveryRoute();

    const row = await screen.findByText("no match");
    expect(row.parentElement).toHaveTextContent("not delivered");
    expect(row.parentElement).toHaveTextContent("catch-all");
  });

  it("with routes and no catch-all, says unmatched alerts are not delivered", async () => {
    mocks.listAlertingRoutes.mockResolvedValue([route()]);

    renderDeliveryRoute();

    const row = await screen.findByText("no match");
    expect(row.parentElement).toHaveTextContent("not delivered");
    expect(row.parentElement).toHaveTextContent("catch-all");
  });

  it("with a catch-all route, hides the fall-through row entirely", async () => {
    mocks.listAlertingRoutes.mockResolvedValue([
      route(),
      route({ id: "44444444-4444-4444-4444-444444444444", matchers: [] }),
    ]);

    renderDeliveryRoute();

    await screen.findByText("any alert");
    expect(screen.queryByText("no match")).not.toBeInTheDocument();
  });
});

describe("/alerts/delivery route safety", () => {
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

    renderDeliveryRoute();

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

describe("/alerts/delivery channels section", () => {
  it("creates a channel with the {name, config} payload shape, once the name is free and the config complete", async () => {
    mocks.listAlertingChannels.mockResolvedValue([
      channel({ name: "team-slack" }),
    ]);
    mocks.createAlertingChannel.mockResolvedValue(channel({ name: "hook" }));
    const user = userEvent.setup();

    renderDeliveryRoute();

    await user.click(
      await screen.findByRole("button", { name: "New channel" }),
    );
    const dialog = await findSettledDrawer();
    const create = within(dialog).getByRole("button", {
      name: "Create channel",
    });
    const name = within(dialog).getByLabelText("Name");
    expect(create).toBeDisabled();

    await user.type(name, "hook");
    expect(create).toBeDisabled();
    await user.type(
      within(dialog).getByLabelText("Webhook URL"),
      "https://example.com/hook",
    );
    expect(create).toBeEnabled();

    // Duplicate names are blocked before submission.
    await user.clear(name);
    await user.type(name, "team-slack");
    expect(create).toBeDisabled();

    await user.clear(name);
    await user.type(name, "hook");
    await user.click(create);

    await waitFor(() =>
      expect(mocks.createAlertingChannel).toHaveBeenCalledWith({
        data: {
          name: "hook",
          config: { type: "webhook", url: "https://example.com/hook" },
        },
      }),
    );
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
  });

  it("surfaces a channel deletion conflict from referring receivers", async () => {
    mocks.listAlertingChannels.mockResolvedValue([
      channel({ name: "team-slack" }),
    ]);
    mocks.deleteAlertingChannel.mockRejectedValueOnce(
      new Error("channel is referenced by receivers: oncall, ops"),
    );
    const user = userEvent.setup();

    renderDeliveryRoute();

    const remove = await screen.findByRole("button", {
      name: "Delete channel team-slack",
    });
    await user.click(remove);
    await user.click(screen.getByRole("button", { name: /^Delete channel$/ }));
    await waitFor(() =>
      expect(screen.getByText("Deletion did not finish")).toBeInTheDocument(),
    );
    expect(
      screen.getByText("channel is referenced by receivers: oncall, ops"),
    ).toBeInTheDocument();
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();

    mocks.deleteAlertingChannel.mockResolvedValue({ deleted: true });
    await user.click(screen.getByRole("button", { name: /^Delete channel$/ }));
    await waitFor(() =>
      expect(mocks.deleteAlertingChannel).toHaveBeenLastCalledWith({
        data: { name: "team-slack" },
      }),
    );
    expect(mocks.toastSuccess).toHaveBeenCalledWith("Channel deleted");
  });

  it("removes a channel from receivers that retain another channel, then deletes it", async () => {
    mocks.listAlertingChannels.mockResolvedValue([
      channel(),
      channel({
        id: "55555555-5555-5555-5555-555555555555",
        name: "team-slack",
        config: { type: "slack", url: "***" },
      }),
    ]);
    mocks.listAlertingReceivers.mockResolvedValue([
      receiver({ channels: ["oncall-hook", "team-slack"] }),
    ]);
    mocks.updateAlertingReceiver.mockResolvedValue(
      receiver({ channels: ["oncall-hook"] }),
    );
    mocks.deleteAlertingChannel.mockResolvedValue({ deleted: true });
    const user = userEvent.setup();

    renderDeliveryRoute();

    await user.click(
      await screen.findByRole("button", {
        name: "Delete channel team-slack",
      }),
    );
    const dialog = screen.getByRole("alertdialog");
    expect(within(dialog).getByText("Changes")).toBeInTheDocument();
    expect(dialog).toHaveTextContent(
      "Remove team-slack from oncall. It keeps oncall-hook.",
    );
    await user.click(screen.getByRole("button", { name: /^Delete channel$/ }));

    await waitFor(() =>
      expect(mocks.updateAlertingReceiver).toHaveBeenCalledWith({
        data: { name: "oncall", channels: ["oncall-hook"] },
      }),
    );
    expect(mocks.deleteAlertingChannel).toHaveBeenCalledWith({
      data: { name: "team-slack" },
    });
    expect(mocks.toastSuccess).toHaveBeenCalledWith(
      "Channel deleted and 1 receiver updated",
    );
  });

  it("shows the impact dialog but blocks deletion when a receiver would become empty", async () => {
    mocks.listAlertingChannels.mockResolvedValue([channel()]);
    mocks.listAlertingReceivers.mockResolvedValue([receiver()]);
    const user = userEvent.setup();

    renderDeliveryRoute();

    await user.click(
      await screen.findByRole("button", {
        name: "Delete channel oncall-hook",
      }),
    );

    expect(screen.getByText(/oncall has no other channel/)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /^Delete channel$/ }),
    ).not.toBeInTheDocument();
    const editReceiver = screen.getByRole("button", { name: "Edit oncall" });
    expect(editReceiver).toBeEnabled();
    expect(mocks.updateAlertingReceiver).not.toHaveBeenCalled();
    expect(mocks.deleteAlertingChannel).not.toHaveBeenCalled();

    await user.click(editReceiver);
    expect(await findSettledDrawer()).toHaveTextContent("Edit receiver");
  });
});

describe("/alerts/delivery receivers section", () => {
  it("creates a receiver by picking existing channels (names-only payload), needing a free name and at least one channel", async () => {
    mocks.listAlertingChannels.mockResolvedValue([
      channel({ name: "team-slack", config: { type: "slack", url: "***" } }),
      channel({
        name: "ops-mail",
        config: { type: "email", to: ["ops@example.com"] },
      }),
    ]);
    mocks.listAlertingReceivers.mockResolvedValue([
      receiver({ name: "oncall" }),
    ]);
    mocks.createAlertingReceiver.mockResolvedValue(
      receiver({ name: "multi", channels: ["team-slack", "ops-mail"] }),
    );
    const user = userEvent.setup();

    renderDeliveryRoute();

    await user.click(
      await screen.findByRole("button", { name: "New receiver" }),
    );
    const dialog = await findSettledDrawer();
    const create = within(dialog).getByRole("button", {
      name: "Create receiver",
    });
    const name = within(dialog).getByLabelText("Name");
    const teamSlack = within(dialog).getByRole("checkbox", {
      name: "Channel team-slack",
    });

    // Duplicate names are blocked before submission.
    await user.type(name, "oncall");
    await user.click(teamSlack);
    expect(create).toBeDisabled();

    await user.clear(name);
    await user.type(name, "multi");
    expect(create).toBeEnabled();

    // The pick is a real requirement, on the way out as well as in.
    await user.click(teamSlack);
    expect(create).toBeDisabled();

    await user.click(teamSlack);
    await user.click(
      within(dialog).getByRole("checkbox", { name: "Channel ops-mail" }),
    );
    await user.click(create);

    await waitFor(() =>
      expect(mocks.createAlertingReceiver).toHaveBeenCalledWith({
        data: { name: "multi", channels: ["team-slack", "ops-mail"] },
      }),
    );
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
  });

  it("surfaces the reason a receiver deletion is rejected", async () => {
    mocks.listAlertingReceivers.mockResolvedValue([
      receiver({ name: "oncall" }),
    ]);
    mocks.deleteAlertingReceiver.mockRejectedValueOnce(new Error("not found"));
    const user = userEvent.setup();

    renderDeliveryRoute();

    const remove = await screen.findByRole("button", {
      name: "Delete receiver oncall",
    });
    await user.click(remove);
    await user.click(screen.getByRole("button", { name: /^Delete receiver$/ }));
    await waitFor(() =>
      expect(screen.getByText("Deletion did not finish")).toBeInTheDocument(),
    );
    expect(screen.getByText("not found")).toBeInTheDocument();

    mocks.deleteAlertingReceiver.mockResolvedValue({ deleted: true });
    await user.click(screen.getByRole("button", { name: /^Delete receiver$/ }));
    await waitFor(() =>
      expect(mocks.deleteAlertingReceiver).toHaveBeenLastCalledWith({
        data: { name: "oncall" },
      }),
    );
    expect(mocks.toastSuccess).toHaveBeenCalledWith("Receiver deleted");
  });
});

describe("/alerts/delivery matcher name resolution", () => {
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

    renderDeliveryRoute();

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

    renderDeliveryRoute();

    expect(await screen.findByText(RULE_ID)).toBeInTheDocument();
  });
});

describe("/alerts/delivery edit flows", () => {
  it("edits a channel in place: config re-entered, rename in PUT payload", async () => {
    mocks.listAlertingChannels.mockResolvedValue([channel()]);
    mocks.updateAlertingChannel.mockResolvedValue(channel());
    const user = userEvent.setup();

    renderDeliveryRoute();

    await user.click(
      await screen.findByRole("button", { name: "Edit channel oncall-hook" }),
    );
    const drawer = await findSettledDrawer();

    // ID references keep receivers attached across a channel rename.
    const nameInput = within(drawer).getByLabelText("Name");
    expect(nameInput).toHaveValue("oncall-hook");
    // The stored URL is write-only (redacted on read), so the field starts
    // blank and saving requires a value.
    const url = within(drawer).getByLabelText("Webhook URL");
    expect(url).toHaveValue("");
    const save = within(drawer).getByRole("button", { name: "Save channel" });
    expect(save).toBeDisabled();

    await user.type(url, "https://example.com/rotated");
    await user.clear(nameInput);
    await user.type(nameInput, "ops-hook");
    await user.click(save);

    await waitFor(() =>
      expect(mocks.updateAlertingChannel).toHaveBeenCalledWith({
        data: {
          name: "oncall-hook",
          newName: "ops-hook",
          config: { type: "webhook", url: "https://example.com/rotated" },
        },
      }),
    );
    expect(mocks.createAlertingChannel).not.toHaveBeenCalled();
  });

  it("edits a receiver in place: channels prefilled, only UI-editable fields sent", async () => {
    mocks.listAlertingReceivers.mockResolvedValue([receiver()]);
    mocks.listAlertingChannels.mockResolvedValue([
      channel(),
      channel({
        name: "backup-mail",
        config: { type: "email", to: ["a@b.c"] },
      }),
    ]);
    mocks.updateAlertingReceiver.mockResolvedValue(receiver());
    const user = userEvent.setup();

    renderDeliveryRoute();

    await user.click(
      await screen.findByRole("button", { name: "Edit receiver oncall" }),
    );
    const drawer = await findSettledDrawer();

    // An unchanged name is a plain replacement.
    expect(within(drawer).getByLabelText("Name")).toHaveValue("oncall");
    expect(within(drawer).getByLabelText("Channel oncall-hook")).toBeChecked();

    await user.click(within(drawer).getByLabelText("Channel backup-mail"));
    await user.click(
      within(drawer).getByRole("button", { name: "Save receiver" }),
    );

    await waitFor(() =>
      expect(mocks.updateAlertingReceiver).toHaveBeenCalledWith({
        data: {
          name: "oncall",
          newName: "oncall",
          channels: ["oncall-hook", "backup-mail"],
        },
      }),
    );
    expect(mocks.createAlertingReceiver).not.toHaveBeenCalled();
  });
});
