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
  CcChannel,
  CcReceiver,
  CcRoute,
  CcSubscription,
} from "@/data/cc/types";
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
  listCcRules: mocks.listCcRules,
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

function subscription(id: string): CcSubscription {
  return {
    id,
    tenant: "org1",
    webhook_url: `https://example.com/firehose/${id}`,
    created_at: "2026-06-14T12:00:00Z",
  } as CcSubscription;
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
  mocks.listCcSubscriptions.mockResolvedValue([]);
});

describe("/alerts/delivery pipeline", () => {
  it("renders a route as its flow: priority, matchers, receiver, resolved channels", async () => {
    mocks.listCcRoutes.mockResolvedValue([route()]);
    mocks.listCcReceivers.mockResolvedValue([receiver()]);
    mocks.listCcChannels.mockResolvedValue([channel()]);

    renderDeliveryRoute();

    expect(await screen.findByText("#0")).toBeInTheDocument();
    expect(screen.getByText("severity")).toBeInTheDocument();
    expect(screen.getByText("critical")).toBeInTheDocument();
    expect(screen.getAllByText("oncall").length).toBeGreaterThan(0);
    // Channel chip resolved through the receiver, with its type label.
    expect(screen.getAllByText("oncall-hook").length).toBeGreaterThan(0);
    expect(screen.getAllByText("webhook").length).toBeGreaterThan(0);
  });

  it("marks a continue route so the chain reads off the pipeline", async () => {
    mocks.listCcRoutes.mockResolvedValue([
      route({ continue: true, id: "aaaa", priority: 0 }),
      route({ id: "bbbb", priority: 1, matchers: [] }),
    ]);
    mocks.listCcReceivers.mockResolvedValue([receiver()]);

    renderDeliveryRoute();

    expect(await screen.findByText("continue")).toBeInTheDocument();
    expect(screen.getByText("any alert")).toBeInTheDocument();
  });

  it("terminates with the firehose fallback and its subscriber count", async () => {
    mocks.listCcSubscriptions.mockResolvedValue([
      subscription("s1"),
      subscription("s2"),
    ]);

    renderDeliveryRoute();

    expect(await screen.findByText("no match")).toBeInTheDocument();
    expect(screen.getByText("· 2 webhooks")).toBeInTheDocument();
  });

  it("flags an empty firehose in amber wording (no subscribers)", async () => {
    renderDeliveryRoute();

    expect(await screen.findByText("no match")).toBeInTheDocument();
    expect(screen.getByText("· no subscribers")).toBeInTheDocument();
  });
});

describe("/alerts/delivery route preview", () => {
  it("highlights the matched route and shows the channel fan-out for a label set", async () => {
    mocks.listCcRoutes.mockResolvedValue([route()]);
    mocks.listCcReceivers.mockResolvedValue([receiver()]);
    mocks.listCcChannels.mockResolvedValue([
      channel({
        name: "oncall-hook",
        config: { type: "email", to: ["oncall@example.com"] },
      }),
    ]);
    const user = userEvent.setup();

    renderDeliveryRoute();
    await screen.findByText("#0");

    const input = screen.getByLabelText("Add preview label (key=value)");
    await user.type(input, "severity=critical{Enter}");

    // The engine-true selection: the route row lights up...
    expect(document.querySelectorAll('[data-matched="true"]')).toHaveLength(1);
    // ...and the fan-out readout names the receiver and its email channel.
    const readouts = screen.getAllByText("oncall-hook");
    expect(readouts.length).toBeGreaterThan(1); // pipeline chip + preview readout
    expect(screen.getAllByText("email").length).toBeGreaterThan(0);
    expect(screen.queryByText(/no route matches/)).not.toBeInTheDocument();
  });

  it("states the firehose fallback when nothing matches", async () => {
    mocks.listCcRoutes.mockResolvedValue([route()]);
    mocks.listCcReceivers.mockResolvedValue([receiver()]);
    mocks.listCcSubscriptions.mockResolvedValue([subscription("s1")]);
    const user = userEvent.setup();

    renderDeliveryRoute();
    await screen.findByText("#0");

    const input = screen.getByLabelText("Add preview label (key=value)");
    await user.type(input, "severity=info{Enter}");

    expect(screen.getByText(/no route matches/)).toBeInTheDocument();
    // The terminal firehose node is the highlighted one, not the route.
    const matched = document.querySelectorAll('[data-matched="true"]');
    expect(matched).toHaveLength(1);
    expect(matched[0].textContent).toContain("firehose");
  });

  it("follows a continue chain: every selected route highlights", async () => {
    mocks.listCcRoutes.mockResolvedValue([
      route({ id: "aaaa", priority: 0, continue: true }),
      route({ id: "bbbb", priority: 1, matchers: [], receiver: "ops" }),
    ]);
    mocks.listCcReceivers.mockResolvedValue([
      receiver(),
      receiver({ name: "ops", channels: [] }),
    ]);
    const user = userEvent.setup();

    renderDeliveryRoute();
    await screen.findByText("#0");

    await user.type(
      screen.getByLabelText("Add preview label (key=value)"),
      "severity=critical{Enter}",
    );

    expect(document.querySelectorAll('[data-matched="true"]')).toHaveLength(2);
  });

  it("rejects an entry without key=value shape", async () => {
    const user = userEvent.setup();

    renderDeliveryRoute();
    await screen.findByText("no match");

    await user.type(
      screen.getByLabelText("Add preview label (key=value)"),
      "not-a-label{Enter}",
    );

    expect(
      screen.getByText("Labels are entered as key=value."),
    ).toBeInTheDocument();
    expect(document.querySelectorAll('[data-matched="true"]')).toHaveLength(0);
  });
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

  it("collapses timing behind a disclosure that reads the engine defaults", async () => {
    const user = userEvent.setup();

    renderDeliveryRoute();

    await user.click(await screen.findByRole("button", { name: "New route" }));
    const drawer = await screen.findByRole("dialog");

    // Effective defaults are readable without opening the disclosure...
    expect(
      within(drawer).getByText(
        "wait 10s · interval 300s · repeat never · group by rule, severity",
      ),
    ).toBeInTheDocument();
    // ...and the fields stay out of the way until it is opened.
    expect(
      within(drawer).queryByLabelText("Group wait (s)"),
    ).not.toBeInTheDocument();

    await user.click(within(drawer).getByText("Timing"));
    expect(within(drawer).getByLabelText("Group wait (s)")).toBeInTheDocument();
    expect(
      within(drawer).getByLabelText("Group interval (s)"),
    ).toBeInTheDocument();
    expect(
      within(drawer).getByLabelText("Repeat interval (s)"),
    ).toBeInTheDocument();
  });
});

describe("/alerts/delivery advanced disclosure", () => {
  it("keeps inhibitions and firehose management collapsed until opened", async () => {
    mocks.listCcInhibitions.mockResolvedValue([]);
    const user = userEvent.setup();

    renderDeliveryRoute();
    await screen.findByText("no match");

    expect(screen.queryByText("Inhibitions")).not.toBeInTheDocument();
    expect(
      screen.queryByText("Firehose subscriptions"),
    ).not.toBeInTheDocument();

    await user.click(screen.getByText("Advanced delivery"));

    expect(await screen.findByText("Inhibitions")).toBeInTheDocument();
    expect(screen.getByText("Firehose subscriptions")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "New inhibition" }),
    ).toBeInTheDocument();
  });

  it("carries no invented pro-tier label; the summary alone describes its contents", async () => {
    renderDeliveryRoute();
    await screen.findByText("no match");

    // The trigger's own summary already says what's inside; there's no tier
    // to gate it behind.
    expect(
      screen.getByText("inhibitions · firehose subscriptions"),
    ).toBeInTheDocument();
    expect(screen.queryByText(/^pro$/i)).not.toBeInTheDocument();
  });
});

describe("/alerts/delivery channels section", () => {
  it("lists channels with the redacted target exactly as the engine returns it", async () => {
    // The engine redacts secrets on read; the UI displays what it sends.
    mocks.listCcChannels.mockResolvedValue([
      channel({
        name: "team-slack",
        config: { type: "slack", url: "***" },
      }),
    ]);

    renderDeliveryRoute();

    expect(await screen.findByText("team-slack")).toBeInTheDocument();
    expect(screen.getByText("***")).toBeInTheDocument();
    expect(screen.getByText("slack")).toBeInTheDocument();
  });

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

  it("blocks a duplicate channel name (CC's create is an upsert)", async () => {
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
    expect(mocks.toastSuccess).not.toHaveBeenCalled();
  });
});

describe("/alerts/delivery receivers section", () => {
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

    renderDeliveryRoute();

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

  it("shows an empty state pointing at New channel when no channels exist", async () => {
    mocks.listCcChannels.mockResolvedValue([]);
    const user = userEvent.setup();

    renderDeliveryRoute();

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
    expect(mocks.toastSuccess).not.toHaveBeenCalled();
  });
});
