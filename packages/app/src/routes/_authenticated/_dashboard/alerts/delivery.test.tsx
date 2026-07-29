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
import type { CcChannel, CcReceiver, CcRoute } from "@/data/cc/types";
import { Route as DeliveryFileRoute } from "./delivery";

// ---------------------------------------------------------------------------
// Mocks at the module boundary the route (and the builder drawers it renders)
// talk to: the data module, plus sonner so surfaced errors are assertable.
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({
  listCcRoutes: vi.fn(),
  listCcReceivers: vi.fn(),
  listCcChannels: vi.fn(),
  listCcInhibitions: vi.fn(),
  listCcAlerts: vi.fn(),
  listCcRules: vi.fn(),
  listCcSlos: vi.fn(),
  listCcSubscriptions: vi.fn(),
  listCcLabelKeys: vi.fn(),
  listCcLabelValues: vi.fn(),
  createCcChannel: vi.fn(),
  deleteCcChannel: vi.fn(),
  createCcReceiver: vi.fn(),
  deleteCcReceiver: vi.fn(),
  createCcRoute: vi.fn(),
  updateCcRoute: vi.fn(),
  deleteCcRoute: vi.fn(),
  createCcInhibition: vi.fn(),
  deleteCcInhibition: vi.fn(),
  createCcSubscription: vi.fn(),
  deleteCcSubscription: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("@/data/cc/server", () => ({
  listCcRoutes: mocks.listCcRoutes,
  listCcReceivers: mocks.listCcReceivers,
  listCcChannels: mocks.listCcChannels,
  listCcInhibitions: mocks.listCcInhibitions,
  listCcAlerts: mocks.listCcAlerts,
  listCcRules: mocks.listCcRules,
  listCcSlos: mocks.listCcSlos,
  listCcSubscriptions: mocks.listCcSubscriptions,
  listCcLabelKeys: mocks.listCcLabelKeys,
  listCcLabelValues: mocks.listCcLabelValues,
  createCcChannel: mocks.createCcChannel,
  deleteCcChannel: mocks.deleteCcChannel,
  createCcReceiver: mocks.createCcReceiver,
  deleteCcReceiver: mocks.deleteCcReceiver,
  createCcRoute: mocks.createCcRoute,
  updateCcRoute: mocks.updateCcRoute,
  deleteCcRoute: mocks.deleteCcRoute,
  createCcInhibition: mocks.createCcInhibition,
  deleteCcInhibition: mocks.deleteCcInhibition,
  createCcSubscription: mocks.createCcSubscription,
  deleteCcSubscription: mocks.deleteCcSubscription,
}));

vi.mock("sonner", () => ({
  toast: {
    success: (...a: unknown[]) => mocks.toastSuccess(...a),
    error: (...a: unknown[]) => mocks.toastError(...a),
  },
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function receiver(overrides: Partial<CcReceiver> = {}): CcReceiver {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    tenant: "org1",
    name: "oncall",
    channels: ["oncall-hook"],
    annotations: {},
    ...overrides,
  };
}

function channel(overrides: Partial<CcChannel> = {}): CcChannel {
  return {
    id: "22222222-2222-2222-2222-222222222222",
    tenant: "org1",
    name: "oncall-hook",
    config: { type: "webhook", url: "https://example.com/hook" },
    ...overrides,
  };
}

function route(overrides: Partial<CcRoute> = {}): CcRoute {
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

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

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

beforeEach(() => {
  vi.clearAllMocks();
  mocks.listCcRoutes.mockResolvedValue([]);
  mocks.listCcReceivers.mockResolvedValue([]);
  mocks.listCcChannels.mockResolvedValue([]);
  mocks.listCcInhibitions.mockResolvedValue([]);
  mocks.listCcAlerts.mockResolvedValue([]);
  mocks.listCcRules.mockResolvedValue([]);
  mocks.listCcSlos.mockResolvedValue([]);
  mocks.listCcSubscriptions.mockResolvedValue([]);
  // No canned suggestions: the preview helper below always goes through the
  // custom-entry row, proving a pair outside the suggestion list previews too.
  mocks.listCcLabelKeys.mockResolvedValue([]);
  mocks.listCcLabelValues.mockResolvedValue([]);
});

describe("/alerts/delivery route drawer", () => {
  it("creates a route with the unchanged payload shape and null timing defaults", async () => {
    mocks.createCcRoute.mockResolvedValue(route());
    const user = userEvent.setup();

    renderDeliveryRoute();

    await user.click(await screen.findByRole("button", { name: "New route" }));
    const drawer = await screen.findByRole("dialog");

    await user.type(
      within(drawer).getByLabelText("Send to receiver"),
      "oncall",
    );
    await user.click(
      within(drawer).getByRole("button", { name: "Create route" }),
    );

    await waitFor(() =>
      expect(mocks.createCcRoute).toHaveBeenCalledWith({
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
});

describe("/alerts/delivery channels section", () => {
  it("creates a channel from the drawer with the {name, config} payload shape", async () => {
    mocks.createCcChannel.mockResolvedValue(channel({ name: "hook" }));
    const user = userEvent.setup();

    renderDeliveryRoute();

    await user.click(
      await screen.findByRole("button", { name: "New channel" }),
    );
    const dialog = await screen.findByRole("dialog");

    // Incomplete form: no name, no URL yet.
    const create = within(dialog).getByRole("button", {
      name: "Create channel",
    });
    expect(create).toBeDisabled();

    await user.type(within(dialog).getByLabelText("Name"), "hook");
    expect(create).toBeDisabled();
    await user.type(
      within(dialog).getByLabelText("Webhook URL"),
      "https://example.com/hook",
    );
    expect(create).toBeEnabled();
    await user.click(create);

    await waitFor(() =>
      expect(mocks.createCcChannel).toHaveBeenCalledWith({
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

  it("blocks a duplicate channel name before CC answers 409", async () => {
    mocks.listCcChannels.mockResolvedValue([channel({ name: "team-slack" })]);
    const user = userEvent.setup();

    renderDeliveryRoute();

    await user.click(
      await screen.findByRole("button", { name: "New channel" }),
    );
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("Name"), "team-slack");
    await user.type(
      within(dialog).getByLabelText("Webhook URL"),
      "https://example.com/hook",
    );

    expect(
      within(dialog).getByRole("button", { name: "Create channel" }),
    ).toBeDisabled();
    expect(mocks.createCcChannel).not.toHaveBeenCalled();
  });

  it("deletes an unreferenced channel", async () => {
    mocks.listCcChannels.mockResolvedValue([channel({ name: "spare" })]);
    mocks.deleteCcChannel.mockResolvedValue({ deleted: true });
    const user = userEvent.setup();

    renderDeliveryRoute();

    await user.click(
      await screen.findByRole("button", { name: "Delete channel" }),
    );

    await waitFor(() =>
      expect(mocks.deleteCcChannel).toHaveBeenCalledWith({
        data: { name: "spare" },
      }),
    );
    expect(mocks.toastSuccess).toHaveBeenCalledWith("Channel deleted");
  });

  it("surfaces the engine's 409 (referring receivers) when a referenced channel is deleted", async () => {
    mocks.listCcChannels.mockResolvedValue([channel({ name: "team-slack" })]);
    mocks.deleteCcChannel.mockRejectedValue(
      new Error("channel is referenced by receivers: oncall, ops"),
    );
    const user = userEvent.setup();

    renderDeliveryRoute();

    await user.click(
      await screen.findByRole("button", { name: "Delete channel" }),
    );

    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith(
        "channel is referenced by receivers: oncall, ops",
      ),
    );
  });
});

describe("/alerts/delivery receivers section", () => {
  it("creates a receiver by picking existing channels (names-only payload)", async () => {
    mocks.listCcChannels.mockResolvedValue([
      channel({ name: "team-slack", config: { type: "slack", url: "***" } }),
      channel({
        name: "ops-mail",
        config: { type: "email", to: ["ops@example.com"] },
      }),
    ]);
    mocks.createCcReceiver.mockResolvedValue(
      receiver({ name: "multi", channels: ["team-slack", "ops-mail"] }),
    );
    const user = userEvent.setup();

    renderDeliveryRoute();

    await user.click(
      await screen.findByRole("button", { name: "New receiver" }),
    );
    const dialog = await screen.findByRole("dialog");
    const create = within(dialog).getByRole("button", {
      name: "Create receiver",
    });

    await user.type(within(dialog).getByLabelText("Name"), "multi");
    // Picker validation: no channel picked yet.
    expect(create).toBeDisabled();
    expect(
      within(dialog).getByText("Pick at least one channel"),
    ).toBeInTheDocument();

    await user.click(
      within(dialog).getByRole("checkbox", { name: "Channel team-slack" }),
    );
    expect(create).toBeEnabled();
    await user.click(
      within(dialog).getByRole("checkbox", { name: "Channel ops-mail" }),
    );
    await user.click(create);

    await waitFor(() =>
      expect(mocks.createCcReceiver).toHaveBeenCalledWith({
        data: { name: "multi", channels: ["team-slack", "ops-mail"] },
      }),
    );
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
  });

  it("unpicking a channel disables create again (at least one required)", async () => {
    mocks.listCcChannels.mockResolvedValue([channel({ name: "team-slack" })]);
    const user = userEvent.setup();

    renderDeliveryRoute();

    await user.click(
      await screen.findByRole("button", { name: "New receiver" }),
    );
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("Name"), "picked");
    const box = within(dialog).getByRole("checkbox", {
      name: "Channel team-slack",
    });
    const create = within(dialog).getByRole("button", {
      name: "Create receiver",
    });

    await user.click(box);
    expect(create).toBeEnabled();
    await user.click(box);
    expect(create).toBeDisabled();
    expect(mocks.createCcReceiver).not.toHaveBeenCalled();
  });

  it("blocks a duplicate receiver name before CC answers 409", async () => {
    mocks.listCcChannels.mockResolvedValue([channel({ name: "oncall-hook" })]);
    mocks.listCcReceivers.mockResolvedValue([receiver({ name: "oncall" })]);
    const user = userEvent.setup();

    renderDeliveryRoute();

    await user.click(
      await screen.findByRole("button", { name: "New receiver" }),
    );
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("Name"), "oncall");
    await user.click(
      within(dialog).getByRole("checkbox", { name: "Channel oncall-hook" }),
    );

    expect(
      within(dialog).getByRole("button", { name: "Create receiver" }),
    ).toBeDisabled();
    expect(mocks.createCcReceiver).not.toHaveBeenCalled();
  });

  it("deletes a receiver", async () => {
    mocks.listCcReceivers.mockResolvedValue([receiver({ name: "oncall" })]);
    mocks.deleteCcReceiver.mockResolvedValue({ deleted: true });
    const user = userEvent.setup();

    renderDeliveryRoute();

    await user.click(
      await screen.findByRole("button", { name: "Delete receiver" }),
    );

    await waitFor(() =>
      expect(mocks.deleteCcReceiver).toHaveBeenCalledWith({
        data: { name: "oncall" },
      }),
    );
    expect(mocks.toastSuccess).toHaveBeenCalledWith("Receiver deleted");
  });

  it("surfaces the engine's error message when a deletion is rejected", async () => {
    mocks.listCcReceivers.mockResolvedValue([receiver({ name: "oncall" })]);
    mocks.deleteCcReceiver.mockRejectedValue(new Error("not found"));
    const user = userEvent.setup();

    renderDeliveryRoute();

    await user.click(
      await screen.findByRole("button", { name: "Delete receiver" }),
    );

    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith("not found"),
    );
  });
});
