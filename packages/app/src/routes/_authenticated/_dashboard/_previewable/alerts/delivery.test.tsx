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
  it("creates a channel with the {name, config} payload shape, once the name is free and the config complete", async () => {
    mocks.listCcChannels.mockResolvedValue([channel({ name: "team-slack" })]);
    mocks.createCcChannel.mockResolvedValue(channel({ name: "hook" }));
    const user = userEvent.setup();

    renderDeliveryRoute();

    await user.click(
      await screen.findByRole("button", { name: "New channel" }),
    );
    const dialog = await screen.findByRole("dialog");
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

    // A taken name is blocked here rather than by CC's 409.
    await user.clear(name);
    await user.type(name, "team-slack");
    expect(create).toBeDisabled();

    await user.clear(name);
    await user.type(name, "hook");
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

  it("deletes a channel, surfacing the engine's 409 (referring receivers) when it refuses", async () => {
    mocks.listCcChannels.mockResolvedValue([channel({ name: "team-slack" })]);
    mocks.deleteCcChannel.mockRejectedValueOnce(
      new Error("channel is referenced by receivers: oncall, ops"),
    );
    const user = userEvent.setup();

    renderDeliveryRoute();

    const remove = await screen.findByRole("button", {
      name: "Delete channel",
    });
    await user.click(remove);
    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith(
        "channel is referenced by receivers: oncall, ops",
      ),
    );

    mocks.deleteCcChannel.mockResolvedValue({ deleted: true });
    await user.click(remove);
    await waitFor(() =>
      expect(mocks.deleteCcChannel).toHaveBeenLastCalledWith({
        data: { name: "team-slack" },
      }),
    );
    expect(mocks.toastSuccess).toHaveBeenCalledWith("Channel deleted");
  });
});

describe("/alerts/delivery receivers section", () => {
  it("creates a receiver by picking existing channels (names-only payload), needing a free name and at least one channel", async () => {
    mocks.listCcChannels.mockResolvedValue([
      channel({ name: "team-slack", config: { type: "slack", url: "***" } }),
      channel({
        name: "ops-mail",
        config: { type: "email", to: ["ops@example.com"] },
      }),
    ]);
    mocks.listCcReceivers.mockResolvedValue([receiver({ name: "oncall" })]);
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
    const name = within(dialog).getByLabelText("Name");
    const teamSlack = within(dialog).getByRole("checkbox", {
      name: "Channel team-slack",
    });

    // A taken name is blocked here rather than by CC's 409.
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
      expect(mocks.createCcReceiver).toHaveBeenCalledWith({
        data: { name: "multi", channels: ["team-slack", "ops-mail"] },
      }),
    );
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
  });

  it("deletes a receiver, surfacing the engine's message when the deletion is rejected", async () => {
    mocks.listCcReceivers.mockResolvedValue([receiver({ name: "oncall" })]);
    mocks.deleteCcReceiver.mockRejectedValueOnce(new Error("not found"));
    const user = userEvent.setup();

    renderDeliveryRoute();

    const remove = await screen.findByRole("button", {
      name: "Delete receiver",
    });
    await user.click(remove);
    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith("not found"),
    );

    mocks.deleteCcReceiver.mockResolvedValue({ deleted: true });
    await user.click(remove);
    await waitFor(() =>
      expect(mocks.deleteCcReceiver).toHaveBeenLastCalledWith({
        data: { name: "oncall" },
      }),
    );
    expect(mocks.toastSuccess).toHaveBeenCalledWith("Receiver deleted");
  });
});
