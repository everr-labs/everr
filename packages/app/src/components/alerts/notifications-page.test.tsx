import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { AlertNotificationsData } from "@/data/alerting/delivery/view";
import { NotificationsPage } from "./notifications-page";

function channel(
  name: string,
  overrides: Partial<AlertNotificationsData["channels"][number]> = {},
): AlertNotificationsData["channels"][number] {
  return {
    name,
    config: { type: "slack", url: "***" },
    tiers: [],
    rules: [],
    sent: 0,
    failed: 0,
    lastSentAt: null,
    lastError: null,
    ...overrides,
  };
}

const DATA: AlertNotificationsData = {
  channels: [
    channel("#oncall", {
      tiers: ["critical", "warning"],
      rules: ["checkout/api-latency"],
      sent: 128,
      lastSentAt: new Date().toISOString(),
    }),
    channel("pager", {
      config: { type: "webhook", url: "***" },
      tiers: ["critical"],
      sent: 41,
      failed: 3,
      lastError: "HTTP 429 from endpoint",
    }),
    channel("ops-telegram", {
      config: { type: "telegram", bot_token: "***", chat_ids: ["-100"] },
    }),
  ],
  destination: {
    split: true,
    tiers: {
      all: [],
      critical: ["#oncall", "pager"],
      warning: ["#oncall"],
      info: [],
    },
  },
  overrides: [
    {
      path: "platform/k8s-node-not-ready",
      name: "Node not ready (platform)",
      severity: "warning",
      channels: ["#sre-legacy"],
    },
  ],
  gaps: [
    { kind: "tier", tier: "info", count: 14 },
    {
      kind: "missing-channel",
      rule: {
        path: "platform/k8s-node-not-ready",
        name: "Node not ready (platform)",
      },
      channel: "#sre-legacy",
      count: 6,
    },
  ],
};

function renderPage(
  data: AlertNotificationsData | null,
  handlers: Partial<{
    onNewChannel: (name?: string) => void;
    onEditChannel: (
      channel: AlertNotificationsData["channels"][number],
    ) => void;
    onEditDelivery: () => void;
  }> = {},
) {
  // The rows link to the triage panel, so the page renders inside a router
  // that knows the route the links point at.
  const rootRoute = createRootRoute({ component: Outlet });
  const alertsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "alerts",
    component: () => <div>triage</div>,
  });
  const pageRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "notifications",
    component: () => (
      <NotificationsPage
        data={data}
        pending={false}
        onNewChannel={handlers.onNewChannel ?? (() => {})}
        onEditChannel={handlers.onEditChannel ?? (() => {})}
        onEditDelivery={handlers.onEditDelivery ?? (() => {})}
      />
    ),
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([alertsRoute, pageRoute]),
    history: createMemoryHistory({ initialEntries: ["/notifications"] }),
  });
  render(<RouterProvider router={router} />);
  return router;
}

describe("NotificationsPage", () => {
  it("names every way an alert went nowhere, with the act that closes it", async () => {
    renderPage(DATA);
    const gaps = await screen.findByRole("list", { name: /not delivered/i });
    const rows = within(gaps).getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("Info alerts have no channel");
    expect(rows[0]).toHaveTextContent("14 alerts went nowhere");
    expect(within(rows[0]).getByRole("button")).toHaveTextContent(
      "Pick channels",
    );
    expect(rows[1]).toHaveTextContent(
      "names #sre-legacy, which does not exist",
    );
    expect(rows[1]).toHaveTextContent("6 alerts recorded undelivered");
    expect(within(rows[1]).getByRole("button")).toHaveTextContent(
      "Create #sre-legacy",
    );
  });

  it("seeds a new channel with the name a gap row asked for", async () => {
    const onNewChannel = vi.fn();
    renderPage(DATA, { onNewChannel });
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole("button", { name: "Create #sre-legacy" }),
    );
    expect(onNewChannel).toHaveBeenCalledWith("#sre-legacy");
  });

  it("reads each channel's tiers from the channel's side", async () => {
    renderPage(DATA);
    const channels = await screen.findByRole("list", { name: /channels/i });
    const rows = within(channels).getAllByRole("listitem");
    expect(rows[0]).toHaveTextContent("Critical");
    expect(rows[0]).toHaveTextContent("Warning");
    expect(rows[0]).toHaveTextContent("+ 1 rule by name");
    expect(rows[0]).toHaveTextContent("128 sent");
    expect(rows[1]).toHaveTextContent("41 sent · 3 failed");
    expect(rows[1]).toHaveTextContent("HTTP 429 from endpoint");
    expect(rows[2]).toHaveTextContent("not in use");
    expect(rows[2]).toHaveTextContent("nothing sent");
  });

  it("opens a channel from its name", async () => {
    const onEditChannel = vi.fn();
    renderPage(DATA, { onEditChannel });
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "pager" }));
    expect(onEditChannel).toHaveBeenCalledWith(
      expect.objectContaining({ name: "pager" }),
    );
  });

  it("draws one default target per tier while split, in the overrides' grammar", async () => {
    renderPage(DATA);
    const targets = await screen.findByRole("list", {
      name: /default targets/i,
    });
    const rows = within(targets).getAllByRole("listitem");
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining("Critical"),
      expect.stringContaining("Warning"),
      expect.stringContaining("Info"),
    ]);
    expect(rows[0]).toHaveTextContent("#oncall");
    expect(rows[0]).toHaveTextContent("pager");
    expect(rows[2]).toHaveTextContent("no channel · not delivered");
  });

  it("tells a first-run org what a channel is, and that there is no gap band to fear", async () => {
    renderPage({
      channels: [],
      destination: {
        split: false,
        tiers: { all: [], critical: [], warning: [], info: [] },
      },
      overrides: [],
      gaps: [{ kind: "tier", tier: "all", count: 0 }],
    });
    expect(await screen.findByText(/No channels yet/)).toBeInTheDocument();
    expect(
      screen.getByText("There is no default destination"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("nothing fired in the selected time range"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Edit delivery" }),
    ).toBeDisabled();
  });

  it("stands in with skeletons while loading", async () => {
    renderPage(null);
    expect(await screen.findByText("Loading channels")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New channel" })).toBeDisabled();
  });
});
