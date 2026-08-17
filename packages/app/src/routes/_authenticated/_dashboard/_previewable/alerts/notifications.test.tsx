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
import type {
  AlertingChannel,
  AlertingReceiver,
  AlertingRoute,
} from "@/data/alerting/types";
import { Route as NotificationsFileRoute } from "./notifications";

const mocks = vi.hoisted(() => ({
  listAlertingRoutes: vi.fn(),
  listAlertingReceivers: vi.fn(),
  listAlertingChannels: vi.fn(),
  createAlertingChannel: vi.fn(),
  updateAlertingChannel: vi.fn(),
  deleteAlertingChannel: vi.fn(),
  createAlertingReceiver: vi.fn(),
  updateAlertingReceiver: vi.fn(),
  deleteAlertingReceiver: vi.fn(),
  listAlertingRules: vi.fn(),
  listAlertingLabelKeys: vi.fn(),
  listAlertingLabelValues: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("@/data/alerting/delivery/server", () => ({
  listAlertingRoutes: mocks.listAlertingRoutes,
  listAlertingReceivers: mocks.listAlertingReceivers,
  listAlertingChannels: mocks.listAlertingChannels,
  createAlertingChannel: mocks.createAlertingChannel,
  updateAlertingChannel: mocks.updateAlertingChannel,
  deleteAlertingChannel: mocks.deleteAlertingChannel,
  createAlertingReceiver: mocks.createAlertingReceiver,
  updateAlertingReceiver: mocks.updateAlertingReceiver,
  deleteAlertingReceiver: mocks.deleteAlertingReceiver,
}));

// `ReceiversSection` renders `ChannelChip` (route-preview.tsx), which imports
// `Pill` from shared/signal.tsx and named exports from matchers-editor.tsx.
// Neither is called here, but both modules pull in the real rules and routing
// repositories at import time, and those reach `db/client.ts`, which has no
// database to talk to in this environment. Mock the two leaf modules so the
// import graph never gets that far.
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

function renderNotificationsPage(
  // A plain `string` (not the narrower search-param union) so a test can
  // drive an unexpected `?new=` value the way a bookmark or a hand-edited
  // URL would.
  search: { new?: string } = {},
) {
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
  const notificationsRoute = createRoute({
    getParentRoute: () => dashboardRoute,
    path: "alerts/notifications",
    component: NotificationsFileRoute.options.component,
    validateSearch: NotificationsFileRoute.options.validateSearch,
  });
  // Destination of the receivers card's "review routes" guard. A stub is
  // enough: this suite only checks where the router lands.
  const routingRoute = createRoute({
    getParentRoute: () => dashboardRoute,
    path: "alerts/routing",
    component: () => null,
  });

  const routeTree = rootRoute.addChildren([
    authenticatedRoute.addChildren([
      dashboardRoute.addChildren([notificationsRoute, routingRoute]),
    ]),
  ]);

  const searchParams = new URLSearchParams();
  if (search.new) searchParams.set("new", search.new);
  const initialPath = searchParams.size
    ? `/alerts/notifications?${searchParams.toString()}`
    : "/alerts/notifications";
  const history = createMemoryHistory({ initialEntries: [initialPath] });
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
  mocks.listAlertingRules.mockResolvedValue([]);
  mocks.listAlertingLabelKeys.mockResolvedValue([]);
  mocks.listAlertingLabelValues.mockResolvedValue([]);
});

describe("/alerts/notifications receiver-deletion guard", () => {
  it("refuses to delete a receiver while a route still targets it", async () => {
    mocks.listAlertingReceivers.mockResolvedValue([
      receiver({ name: "oncall" }),
    ]);
    mocks.listAlertingRoutes.mockResolvedValue([route({ receiver: "oncall" })]);
    const user = userEvent.setup();

    renderNotificationsPage();

    await user.click(
      await screen.findByRole("button", { name: "Delete receiver oncall" }),
    );

    expect(
      screen.getByText(
        "1 route still targets this receiver. Move that route first. No changes will be made.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /^Delete receiver$/ }),
    ).not.toBeInTheDocument();
    expect(mocks.deleteAlertingReceiver).not.toHaveBeenCalled();
  });

  it("sends the reader to routing to review the routes blocking a deletion", async () => {
    mocks.listAlertingReceivers.mockResolvedValue([
      receiver({ name: "oncall" }),
    ]);
    mocks.listAlertingRoutes.mockResolvedValue([route({ receiver: "oncall" })]);
    const user = userEvent.setup();

    const { router } = renderNotificationsPage();

    await user.click(
      await screen.findByRole("button", { name: "Delete receiver oncall" }),
    );
    await user.click(screen.getByRole("button", { name: "Review routes" }));

    await waitFor(() =>
      expect(router.state.location.pathname).toBe("/alerts/routing"),
    );
  });
});

describe("/alerts/notifications entry from a link", () => {
  it("opens the receiver builder when arriving with ?new=receiver", async () => {
    renderNotificationsPage({ new: "receiver" });

    const drawer = await findSettledDrawer();
    expect(within(drawer).getByText("New receiver")).toBeInTheDocument();
  });

  it("opens the channel builder when arriving with ?new=channel", async () => {
    renderNotificationsPage({ new: "channel" });

    const drawer = await findSettledDrawer();
    expect(within(drawer).getByText("New channel")).toBeInTheDocument();
  });

  it("renders normally with no builder open when ?new= holds an unexpected value", async () => {
    renderNotificationsPage({ new: "bogus" });

    expect(
      await screen.findByRole("heading", { name: "Notifications" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

describe("/alerts/notifications usage facts", () => {
  it("warns about receivers no route targets and channels no receiver references", async () => {
    mocks.listAlertingReceivers.mockResolvedValue([receiver()]);
    mocks.listAlertingChannels.mockResolvedValue([
      channel(),
      channel({ id: "55555555-5555-5555-5555-555555555555", name: "spare" }),
    ]);

    renderNotificationsPage();

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

    renderNotificationsPage();

    expect(await screen.findByText("1 route")).toBeInTheDocument();
    expect(
      screen.queryByText("no route targets this receiver"),
    ).not.toBeInTheDocument();
  });
});

describe("/alerts/notifications channels section", () => {
  it("creates a channel with the {name, config} payload shape, once the name is free and the config complete", async () => {
    mocks.listAlertingChannels.mockResolvedValue([
      channel({ name: "team-slack" }),
    ]);
    mocks.createAlertingChannel.mockResolvedValue(channel({ name: "hook" }));
    const user = userEvent.setup();

    renderNotificationsPage();

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

    renderNotificationsPage();

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

    renderNotificationsPage();

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

    renderNotificationsPage();

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

describe("/alerts/notifications receivers section", () => {
  it("creates a receiver by picking existing channels (names-only payload), needing a free name and at least one channel", async () => {
    mocks.listAlertingChannels.mockResolvedValue([
      channel({ name: "team-slack", config: { type: "slack", url: "***" } }),
      channel({
        name: "ops-discord",
        config: { type: "discord", url: "***" },
      }),
    ]);
    mocks.listAlertingReceivers.mockResolvedValue([
      receiver({ name: "oncall" }),
    ]);
    mocks.createAlertingReceiver.mockResolvedValue(
      receiver({ name: "multi", channels: ["team-slack", "ops-discord"] }),
    );
    const user = userEvent.setup();

    renderNotificationsPage();

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
      within(dialog).getByRole("checkbox", { name: "Channel ops-discord" }),
    );
    await user.click(create);

    await waitFor(() =>
      expect(mocks.createAlertingReceiver).toHaveBeenCalledWith({
        data: { name: "multi", channels: ["team-slack", "ops-discord"] },
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

    renderNotificationsPage();

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

describe("/alerts/notifications edit flows", () => {
  it("edits a channel in place: config re-entered, rename in PUT payload", async () => {
    mocks.listAlertingChannels.mockResolvedValue([channel()]);
    mocks.updateAlertingChannel.mockResolvedValue(channel());
    const user = userEvent.setup();

    renderNotificationsPage();

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
        name: "backup-discord",
        config: { type: "discord", url: "***" },
      }),
    ]);
    mocks.updateAlertingReceiver.mockResolvedValue(receiver());
    const user = userEvent.setup();

    renderNotificationsPage();

    await user.click(
      await screen.findByRole("button", { name: "Edit receiver oncall" }),
    );
    const drawer = await findSettledDrawer();

    // An unchanged name is a plain replacement.
    expect(within(drawer).getByLabelText("Name")).toHaveValue("oncall");
    expect(within(drawer).getByLabelText("Channel oncall-hook")).toBeChecked();

    await user.click(within(drawer).getByLabelText("Channel backup-discord"));
    await user.click(
      within(drawer).getByRole("button", { name: "Save receiver" }),
    );

    await waitFor(() =>
      expect(mocks.updateAlertingReceiver).toHaveBeenCalledWith({
        data: {
          name: "oncall",
          newName: "oncall",
          channels: ["oncall-hook", "backup-discord"],
        },
      }),
    );
    expect(mocks.createAlertingReceiver).not.toHaveBeenCalled();
  });
});
