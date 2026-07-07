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
import type { CcChannel, CcReceiver } from "@/data/cc/types";
import { Route as RoutingFileRoute } from "./routing";

// ---------------------------------------------------------------------------
// Mocks at the module boundary the route (and the builder dialogs it renders)
// talk to: the data module, plus sonner so surfaced errors are assertable.
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({
  listCcRoutes: vi.fn(),
  listCcReceivers: vi.fn(),
  listCcChannels: vi.fn(),
  listCcInhibitions: vi.fn(),
  listCcAlerts: vi.fn(),
  listCcSilences: vi.fn(),
  listCcSubscriptions: vi.fn(),
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
  listCcSilences: mocks.listCcSilences,
  listCcSubscriptions: mocks.listCcSubscriptions,
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

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

function renderRoutingRoute() {
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

  const routeTree = rootRoute.addChildren([
    authenticatedRoute.addChildren([
      dashboardRoute.addChildren([routingRoute]),
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
  mocks.listCcRoutes.mockResolvedValue([]);
  mocks.listCcReceivers.mockResolvedValue([]);
  mocks.listCcChannels.mockResolvedValue([]);
  mocks.listCcInhibitions.mockResolvedValue([]);
  mocks.listCcAlerts.mockResolvedValue([]);
  mocks.listCcSilences.mockResolvedValue([]);
  mocks.listCcSubscriptions.mockResolvedValue([]);
});

describe("/alerts/routing channels section", () => {
  it("lists channels with the redacted target exactly as the engine returns it", async () => {
    // The engine redacts secrets on read; the UI displays what it sends.
    mocks.listCcChannels.mockResolvedValue([
      channel({
        name: "team-slack",
        config: { type: "slack", url: "***" },
      }),
    ]);

    renderRoutingRoute();

    expect(await screen.findByText("team-slack")).toBeInTheDocument();
    expect(screen.getByText("***")).toBeInTheDocument();
    expect(screen.getByText("slack")).toBeInTheDocument();
  });

  it("creates a channel from the dialog with the {name, config} payload shape", async () => {
    mocks.createCcChannel.mockResolvedValue(channel({ name: "hook" }));
    const user = userEvent.setup();

    renderRoutingRoute();

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

  it("blocks a duplicate channel name (CC's create is an upsert)", async () => {
    mocks.listCcChannels.mockResolvedValue([channel({ name: "team-slack" })]);
    const user = userEvent.setup();

    renderRoutingRoute();

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
      within(dialog).getByText("A channel with this name already exists"),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByRole("button", { name: "Create channel" }),
    ).toBeDisabled();
    expect(mocks.createCcChannel).not.toHaveBeenCalled();
  });

  it("deletes an unreferenced channel", async () => {
    mocks.listCcChannels.mockResolvedValue([channel({ name: "spare" })]);
    mocks.deleteCcChannel.mockResolvedValue({ deleted: true });
    const user = userEvent.setup();

    renderRoutingRoute();

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

    renderRoutingRoute();

    await user.click(
      await screen.findByRole("button", { name: "Delete channel" }),
    );

    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith(
        "channel is referenced by receivers: oncall, ops",
      ),
    );
    expect(mocks.toastSuccess).not.toHaveBeenCalled();
  });
});

describe("/alerts/routing receivers section", () => {
  it("lists a receiver's channel names with their resolved types", async () => {
    mocks.listCcChannels.mockResolvedValue([
      channel({ name: "multi-hook" }),
      channel({
        name: "multi-mail",
        config: { type: "email", to: ["oncall@example.com"] },
      }),
    ]);
    mocks.listCcReceivers.mockResolvedValue([
      receiver({ name: "multi", channels: ["multi-hook", "multi-mail"] }),
    ]);

    renderRoutingRoute();

    expect(await screen.findByText("multi")).toBeInTheDocument();
    expect(screen.getByText("multi-hook (webhook)")).toBeInTheDocument();
    expect(screen.getByText("multi-mail (email)")).toBeInTheDocument();
    // The retired as-code marker no longer renders a badge.
    expect(screen.queryByText("as code")).not.toBeInTheDocument();
  });

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

    renderRoutingRoute();

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

    renderRoutingRoute();

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

  it("shows an empty state pointing at New channel when no channels exist", async () => {
    mocks.listCcChannels.mockResolvedValue([]);
    const user = userEvent.setup();

    renderRoutingRoute();

    await user.click(
      await screen.findByRole("button", { name: "New receiver" }),
    );
    const dialog = await screen.findByRole("dialog");

    expect(
      within(dialog).getByText(/No channels yet\./, { exact: false }),
    ).toBeInTheDocument();
    expect(within(dialog).queryByRole("checkbox")).not.toBeInTheDocument();
    expect(
      within(dialog).getByRole("button", { name: "Create receiver" }),
    ).toBeDisabled();
  });

  it("blocks a duplicate name (CC's create is an upsert that would replace it)", async () => {
    mocks.listCcChannels.mockResolvedValue([channel({ name: "oncall-hook" })]);
    mocks.listCcReceivers.mockResolvedValue([receiver({ name: "oncall" })]);
    const user = userEvent.setup();

    renderRoutingRoute();

    await user.click(
      await screen.findByRole("button", { name: "New receiver" }),
    );
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("Name"), "oncall");
    await user.click(
      within(dialog).getByRole("checkbox", { name: "Channel oncall-hook" }),
    );

    expect(
      within(dialog).getByText("A receiver with this name already exists"),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByRole("button", { name: "Create receiver" }),
    ).toBeDisabled();
    expect(mocks.createCcReceiver).not.toHaveBeenCalled();
  });

  it("deletes a receiver", async () => {
    mocks.listCcReceivers.mockResolvedValue([receiver({ name: "oncall" })]);
    mocks.deleteCcReceiver.mockResolvedValue({ deleted: true });
    const user = userEvent.setup();

    renderRoutingRoute();

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

    renderRoutingRoute();

    await user.click(
      await screen.findByRole("button", { name: "Delete receiver" }),
    );

    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith("not found"),
    );
    expect(mocks.toastSuccess).not.toHaveBeenCalled();
  });
});
