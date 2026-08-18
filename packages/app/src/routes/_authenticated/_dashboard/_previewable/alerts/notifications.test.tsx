import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { alertingRuleViewFixture } from "@/data/alerting/test-fixtures";
import { Route as NotificationsFileRoute } from "./notifications";

const mocks = vi.hoisted(() => ({
  listAlertingChannels: vi.fn(),
  getAlertingDefaultDestination: vi.fn(),
  listAlertingRules: vi.fn(),
}));

vi.mock("@/data/alerting/delivery/server", () => ({
  listAlertingChannels: mocks.listAlertingChannels,
  getAlertingDefaultDestination: mocks.getAlertingDefaultDestination,
}));
vi.mock("@/data/alerting/rules/server", () => ({
  listAlertingRules: mocks.listAlertingRules,
}));

function channel(name: string) {
  return {
    id: `ch-${name}`,
    tenant: "org1",
    name,
    config: { type: "slack" as const, url: "***" },
  };
}

function renderNotificationsPage() {
  const rootRoute = createRootRoute({ component: Outlet });
  const alertsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "alerts",
    component: Outlet,
  });
  const notificationsRoute = createRoute({
    getParentRoute: () => alertsRoute,
    path: "notifications",
    component: NotificationsFileRoute.options.component,
    validateSearch: NotificationsFileRoute.options.validateSearch,
  });
  const routeTree = rootRoute.addChildren([
    alertsRoute.addChildren([notificationsRoute]),
  ]);
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({
      initialEntries: ["/alerts/notifications"],
    }),
    context: { queryClient },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  for (const fn of Object.values(mocks)) fn.mockReset();
  mocks.listAlertingChannels.mockResolvedValue([
    channel("team-slack"),
    channel("ops-hook"),
  ]);
  mocks.getAlertingDefaultDestination.mockResolvedValue({
    tiers: { all: ["team-slack"] },
  });
  mocks.listAlertingRules.mockResolvedValue([]);
});

describe("/alerts/notifications", () => {
  it("reads the default destination as one delivery row and tags its channels", async () => {
    renderNotificationsPage();

    const deliveryRow = (await screen.findByText("All alerts")).closest(
      "li",
    ) as HTMLElement;
    expect(within(deliveryRow).getByText("team-slack")).toBeInTheDocument();

    // In the channels list, only the destination member wears the tag.
    const channels = await screen.findByText("team-slack", {
      selector: ".font-medium",
    });
    const row = channels.closest("li") as HTMLElement;
    expect(within(row).getByText("default")).toBeInTheDocument();
    const otherRow = screen
      .getByText("ops-hook", { selector: ".font-medium" })
      .closest("li") as HTMLElement;
    expect(within(otherRow).queryByText("default")).toBeNull();
  });

  it("reads a split destination as one row per severity", async () => {
    mocks.getAlertingDefaultDestination.mockResolvedValue({
      tiers: { critical: ["team-slack"], warning: ["ops-hook"] },
    });

    renderNotificationsPage();

    expect(await screen.findByText("Critical")).toBeInTheDocument();
    expect(screen.getByText("Warning")).toBeInTheDocument();
    // The info tier has no channels: that is a delivery gap, said plainly.
    const info = screen.getByText("Info").closest("li") as HTMLElement;
    expect(
      within(info).getByText(/no channels: these alerts are not delivered/),
    ).toBeInTheDocument();
    expect(screen.queryByText("All alerts")).toBeNull();
  });

  it("lists rules that override the default destination, read-only", async () => {
    mocks.listAlertingRules.mockResolvedValue([
      alertingRuleViewFixture({
        id: "rule-1",
        name: "default/checkout-errors",
        notifications: { channels: ["ops-hook"] },
      }),
      alertingRuleViewFixture({
        id: "rule-2",
        name: "default/quiet-rule",
      }),
    ]);

    renderNotificationsPage();

    const heading = await screen.findByRole("heading", {
      name: "Rule overrides",
    });
    const section = within(heading.closest("[id]") as HTMLElement);
    expect(
      await section.findByRole("link", { name: "checkout-errors" }),
    ).toBeInTheDocument();
    expect(section.getByText("ops-hook")).toBeInTheDocument();
    expect(section.queryByText("quiet-rule")).toBeNull();
    // Overrides are as-code: no edit or delete affordance here.
    expect(section.queryByRole("button")).toBeNull();
  });

  it("offers setup instead of a false empty when nothing is configured", async () => {
    mocks.listAlertingChannels.mockResolvedValue([]);
    mocks.getAlertingDefaultDestination.mockResolvedValue({ tiers: {} });

    renderNotificationsPage();

    expect(
      await screen.findByText("No default destination"),
    ).toBeInTheDocument();
    expect(screen.getByText("No channels defined")).toBeInTheDocument();
  });
});
