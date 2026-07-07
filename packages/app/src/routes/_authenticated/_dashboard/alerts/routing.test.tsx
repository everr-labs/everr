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
import type { CcReceiver } from "@/data/cc/types";
import { Route as RoutingFileRoute } from "./routing";

// ---------------------------------------------------------------------------
// Mocks at the module boundary the route (and the builder dialogs it renders)
// talk to: the data module, plus sonner so surfaced errors are assertable.
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({
  listCcRoutes: vi.fn(),
  listCcReceivers: vi.fn(),
  listCcInhibitions: vi.fn(),
  listCcAlerts: vi.fn(),
  listCcSilences: vi.fn(),
  listCcSubscriptions: vi.fn(),
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
  listCcInhibitions: mocks.listCcInhibitions,
  listCcAlerts: mocks.listCcAlerts,
  listCcSilences: mocks.listCcSilences,
  listCcSubscriptions: mocks.listCcSubscriptions,
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
    channel: { type: "webhook", url: "https://example.com/hook" },
    annotations: {},
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

describe("/alerts/routing receivers section", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listCcRoutes.mockResolvedValue([]);
    mocks.listCcReceivers.mockResolvedValue([]);
    mocks.listCcInhibitions.mockResolvedValue([]);
    mocks.listCcAlerts.mockResolvedValue([]);
    mocks.listCcSilences.mockResolvedValue([]);
    mocks.listCcSubscriptions.mockResolvedValue([]);
  });

  it("lists receivers with the channel target exactly as the engine returns it", async () => {
    // The engine redacts secrets on read; the UI displays what it sends.
    mocks.listCcReceivers.mockResolvedValue([
      receiver({
        name: "slack-oncall",
        channel: { type: "slack", url: "***" },
      }),
    ]);

    renderRoutingRoute();

    expect(await screen.findByText("slack-oncall")).toBeInTheDocument();
    expect(screen.getByText("***")).toBeInTheDocument();
    // The retired as-code marker no longer renders a badge.
    expect(screen.queryByText("as code")).not.toBeInTheDocument();
  });

  it("creates a webhook receiver from the dialog with the engine payload shape", async () => {
    mocks.createCcReceiver.mockResolvedValue(receiver({ name: "hook" }));
    const user = userEvent.setup();

    renderRoutingRoute();

    await user.click(
      await screen.findByRole("button", { name: "New receiver" }),
    );
    const dialog = await screen.findByRole("dialog");

    // Incomplete form: no name, no URL yet.
    const create = within(dialog).getByRole("button", {
      name: "Create receiver",
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
      expect(mocks.createCcReceiver).toHaveBeenCalledWith({
        data: {
          name: "hook",
          channel: { type: "webhook", url: "https://example.com/hook" },
        },
      }),
    );
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
  });

  it("blocks a duplicate name (CC's create is an upsert that would replace it)", async () => {
    mocks.listCcReceivers.mockResolvedValue([receiver({ name: "oncall" })]);
    const user = userEvent.setup();

    renderRoutingRoute();

    await user.click(
      await screen.findByRole("button", { name: "New receiver" }),
    );
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("Name"), "oncall");
    await user.type(
      within(dialog).getByLabelText("Webhook URL"),
      "https://example.com/hook",
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
