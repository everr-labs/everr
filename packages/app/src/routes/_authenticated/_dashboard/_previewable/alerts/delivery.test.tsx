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
import { ccRuleViewFixture } from "@/data/cc/test-fixtures";
import type {
  CcChannel,
  CcReceiver,
  CcRoute,
  CcRuleView,
} from "@/data/cc/types";
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
  updateCcChannel: vi.fn(),
  deleteCcChannel: vi.fn(),
  createCcReceiver: vi.fn(),
  updateCcReceiver: vi.fn(),
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
  updateCcChannel: mocks.updateCcChannel,
  deleteCcChannel: mocks.deleteCcChannel,
  createCcReceiver: mocks.createCcReceiver,
  updateCcReceiver: mocks.updateCcReceiver,
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

describe("/alerts/delivery pipeline fall-through", () => {
  it("with zero routes, points at the firehose", async () => {
    renderDeliveryRoute();

    const row = await screen.findByText("no match");
    expect(row.parentElement).toHaveTextContent("firehose");
    expect(row.parentElement).toHaveTextContent("no subscribers");
    expect(row.parentElement).not.toHaveTextContent("not delivered");
  });

  it("with routes and no catch-all, says unmatched alerts are not delivered", async () => {
    mocks.listCcRoutes.mockResolvedValue([route()]);

    renderDeliveryRoute();

    const row = await screen.findByText("no match");
    expect(row.parentElement).toHaveTextContent("not delivered");
    expect(row.parentElement).toHaveTextContent("catch-all");
    expect(row.parentElement).not.toHaveTextContent("firehose");
  });

  it("with a catch-all route, hides the fall-through row entirely", async () => {
    mocks.listCcRoutes.mockResolvedValue([
      route(),
      route({ id: "44444444-4444-4444-4444-444444444444", matchers: [] }),
    ]);

    renderDeliveryRoute();

    await screen.findByText("any alert");
    expect(screen.queryByText("no match")).not.toBeInTheDocument();
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

describe("/alerts/delivery matcher name resolution", () => {
  const RULE_ID = "44444444-4444-4444-4444-444444444444";

  function ccRuleView(overrides: Partial<CcRuleView> = {}): CcRuleView {
    return ccRuleViewFixture({
      id: RULE_ID,
      spec: {
        interval_secs: 30,
        value_column: null,
        severity: "info",
      },
      rollup: {
        alert_state: "inactive",
        firing_instance_count: 0,
        last_fired_at: null,
        last_resolved_at: null,
        last_seen_at: null,
        last_row_count: null,
      },
      ...overrides,
    });
  }

  it("renders a rule matcher as the rule's linked name, keeping the id as the title", async () => {
    mocks.listCcRules.mockResolvedValue([ccRuleView()]);
    mocks.listCcRoutes.mockResolvedValue([
      route({ matchers: [{ label: "rule", op: "eq", value: RULE_ID }] }),
    ]);
    mocks.listCcReceivers.mockResolvedValue([receiver()]);
    mocks.listCcChannels.mockResolvedValue([channel()]);

    renderDeliveryRoute();

    const link = await screen.findByRole("link", { name: "flapping" });
    expect(link).toHaveAttribute("title", RULE_ID);
    // The raw id never renders as text: it lives on the title only.
    expect(screen.queryByText(RULE_ID)).toBeNull();
  });

  it("keeps the raw value for matchers it cannot resolve", async () => {
    mocks.listCcRoutes.mockResolvedValue([
      route({ matchers: [{ label: "rule", op: "eq", value: RULE_ID }] }),
    ]);
    mocks.listCcReceivers.mockResolvedValue([receiver()]);
    mocks.listCcChannels.mockResolvedValue([channel()]);

    renderDeliveryRoute();

    expect(await screen.findByText(RULE_ID)).toBeInTheDocument();
  });
});

describe("/alerts/delivery edit flows", () => {
  it("edits a channel in place: config re-entered, rename in PUT payload", async () => {
    mocks.listCcChannels.mockResolvedValue([channel()]);
    mocks.updateCcChannel.mockResolvedValue(channel());
    const user = userEvent.setup();

    renderDeliveryRoute();

    await user.click(
      await screen.findByRole("button", { name: "Edit channel" }),
    );
    const drawer = await screen.findByRole("dialog");

    // The name is an editable label: the engine references channels by id, so
    // a rename rides along in the same PUT as `newName`.
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
      expect(mocks.updateCcChannel).toHaveBeenCalledWith({
        data: {
          name: "oncall-hook",
          newName: "ops-hook",
          config: { type: "webhook", url: "https://example.com/rotated" },
        },
      }),
    );
    expect(mocks.createCcChannel).not.toHaveBeenCalled();
  });

  it("edits a receiver in place: channels prefilled, annotations passed through", async () => {
    mocks.listCcReceivers.mockResolvedValue([
      receiver({ annotations: { team: "core" } }),
    ]);
    mocks.listCcChannels.mockResolvedValue([
      channel(),
      channel({
        name: "backup-mail",
        config: { type: "email", to: ["a@b.c"] },
      }),
    ]);
    mocks.updateCcReceiver.mockResolvedValue(receiver());
    const user = userEvent.setup();

    renderDeliveryRoute();

    await user.click(
      await screen.findByRole("button", { name: "Edit receiver" }),
    );
    const drawer = await screen.findByRole("dialog");

    // The desired name is always sent; the engine treats an unchanged name as
    // a plain replace.
    expect(within(drawer).getByLabelText("Name")).toHaveValue("oncall");
    expect(within(drawer).getByLabelText("Channel oncall-hook")).toBeChecked();

    await user.click(within(drawer).getByLabelText("Channel backup-mail"));
    await user.click(
      within(drawer).getByRole("button", { name: "Save receiver" }),
    );

    await waitFor(() =>
      expect(mocks.updateCcReceiver).toHaveBeenCalledWith({
        data: {
          name: "oncall",
          newName: "oncall",
          channels: ["oncall-hook", "backup-mail"],
          annotations: { team: "core" },
        },
      }),
    );
    expect(mocks.createCcReceiver).not.toHaveBeenCalled();
  });
});
