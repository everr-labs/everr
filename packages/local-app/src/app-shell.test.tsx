import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { getRouter } from "./router";
import { mockCommands } from "./test-commands";

type CollectorStatus = {
  status: "starting" | "running" | "failed" | "stopped";
  reason?: string;
  otlpEndpoint: string;
  sqlEndpoint: string;
  healthEndpoint: string;
  telemetryDir?: string;
};

const endpoints = {
  otlpEndpoint: "http://127.0.0.1:54318",
  sqlEndpoint: "http://127.0.0.1:54320",
  healthEndpoint: "http://127.0.0.1:54320/health",
  telemetryDir: "/tmp/everr/telemetry-dev",
};
const running = { status: "running", ...endpoints } satisfies CollectorStatus;
const failed = {
  status: "failed",
  reason: "collector exited",
  ...endpoints,
} satisfies CollectorStatus;

const renderedRouters: ReturnType<typeof getRouter>[] = [];

// A load still in flight when the file ends (a collector status change
// invalidates the router) commits after jsdom is torn down and throws
// "window is not defined". Let each router settle before it is unmounted.
afterEach(async () => {
  for (const router of renderedRouters.splice(0)) {
    await waitFor(() => {
      if (router.state.status !== "idle") throw new Error("The router is still loading");
    });
  }
});

function renderMainApp(
  options: {
    collectorStatus?: CollectorStatus;
    initialEntry?: string;
    sqlQuery?: () => unknown;
  } = {},
) {
  let collectorStatus = options.collectorStatus ?? running;
  const restartCollectorSpy = vi.fn(() => {
    collectorStatus = running;
    return collectorStatus;
  });

  const localCommandSpy = vi.fn((command: string) => {
    switch (command) {
      case "get_collector_status":
        return collectorStatus;
      case "telemetry_sql_query":
        // The collector's SQL endpoint answers only while it runs.
        if (collectorStatus.status !== "running") throw new Error("collector is not running");
        return options.sqlQuery ? options.sqlQuery() : [];
      case "restart_collector":
        return restartCollectorSpy();
      default:
        throw new Error(`Unexpected local command: ${command}`);
    }
  });
  mockCommands(localCommandSpy);

  const router = getRouter();
  router.update({
    history: createMemoryHistory({ initialEntries: [options.initialEntry ?? "/settings"] }),
    context: router.options.context,
  });
  render(<RouterProvider router={router} />);
  renderedRouters.push(router);

  return {
    router,
    restartCollectorSpy,
    localCommandSpy,
    setCollectorStatus: (next: CollectorStatus) => {
      collectorStatus = next;
    },
  };
}

function sidebarLink(name: string) {
  const sidebar = document.querySelector<HTMLElement>('[data-slot="sidebar"]');
  if (!sidebar) throw new Error("The sidebar is not rendered");
  return within(sidebar).getByRole("link", { name });
}

describe("local app shell", () => {
  it("lists the Explore pages and Settings in the sidebar and calls only collector commands", async () => {
    const { router, localCommandSpy } = renderMainApp();
    await act(async () => {
      await router.navigate({ to: "/logs" });
    });

    for (const name of ["Metrics", "Logs", "Traces", "Errors", "Settings"]) {
      expect(sidebarLink(name)).toBeInTheDocument();
    }
    const localCommands = new Set(["get_collector_status", "telemetry_sql_query"]);
    await waitFor(() => expect(localCommandSpy).toHaveBeenCalled());
    expect(localCommandSpy.mock.calls.every(([command]) => localCommands.has(command))).toBe(true);
  });

  it("opens on Logs from the root", async () => {
    const { router } = renderMainApp({ initialEntry: "/" });

    await waitFor(() => expect(router.state.location.pathname).toBe("/logs"));
    expect(sidebarLink("Logs")).toHaveAttribute("data-active", "true");
  });

  it("names the open page in the header and lights it up in the sidebar", async () => {
    renderMainApp({ initialEntry: "/settings" });

    expect(await screen.findByRole("heading", { name: "Settings" })).toBeInTheDocument();
    expect(document.querySelector("[data-app-header]")).toHaveTextContent("Settings");
    expect(sidebarLink("Settings")).toHaveAttribute("data-active", "true");
    expect(sidebarLink("Logs")).not.toHaveAttribute("data-active");
  });

  it("keeps the time range when you move to another Explore page", async () => {
    const user = userEvent.setup({ skipHover: true });
    const { router } = renderMainApp({ initialEntry: "/logs?from=now-1h&to=now&refresh=30s" });

    expect(await screen.findByRole("button", { name: /last 1 hour/i })).toBeInTheDocument();
    await user.click(sidebarLink("Traces"));

    await waitFor(() => expect(router.state.location.pathname).toBe("/traces"));
    expect(router.state.location.search).toMatchObject({
      from: "now-1h",
      to: "now",
      refresh: "30s",
    });
    expect(screen.getByRole("button", { name: /last 1 hour/i })).toBeInTheDocument();
  });

  it("lists the Developer page next to Settings in development builds", async () => {
    renderMainApp({ initialEntry: "/developer" });

    expect(await screen.findByRole("heading", { name: "Developer" })).toBeInTheDocument();
    expect(sidebarLink("Developer")).toHaveAttribute("data-active", "true");
    for (const name of [
      "Throw uncaught error",
      "Reject a promise",
      "Log console.error",
      "Capture handled error",
    ]) {
      expect(screen.getByRole("button", { name })).toBeInTheDocument();
    }
  });

  it("shows the time range controls on Explore pages only", async () => {
    const { router } = renderMainApp({ initialEntry: "/logs" });
    expect(await screen.findByRole("button", { name: /last 7 days/i })).toBeInTheDocument();

    await act(async () => {
      await router.navigate({ to: "/settings" });
    });

    await screen.findByRole("heading", { name: "Settings" });
    expect(screen.queryByRole("button", { name: /last 7 days/i })).toBeNull();
  });
});

describe("local telemetry collector", () => {
  it("shows an inline restart action when logs are unavailable", async () => {
    const { router, restartCollectorSpy } = renderMainApp({ collectorStatus: failed });

    await act(async () => {
      await router.navigate({ to: "/logs" });
    });

    expect(await screen.findByText("Local telemetry unavailable")).toBeInTheDocument();
    expect(screen.getByText("collector exited")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Restart collector" }));

    await waitFor(() => {
      expect(restartCollectorSpy).toHaveBeenCalledTimes(1);
    });
  });

  it("shows a starting gate while the collector is starting", async () => {
    const { router } = renderMainApp({ collectorStatus: { status: "starting", ...endpoints } });

    await act(async () => {
      await router.navigate({ to: "/logs" });
    });

    expect(await screen.findByText("Starting local telemetry")).toBeInTheDocument();
    expect(screen.getByText("The local collector is starting.")).toBeInTheDocument();
  });

  it("keeps Settings reachable while the collector is down", async () => {
    renderMainApp({ collectorStatus: failed, initialEntry: "/settings" });

    expect(await screen.findByText("Local telemetry")).toBeInTheDocument();
    expect(screen.queryByText("Local telemetry unavailable")).toBeNull();
  });

  it("shows local telemetry diagnostics in settings", async () => {
    renderMainApp({ collectorStatus: { ...running, reason: "all good" } });

    expect(await screen.findByText("Local telemetry")).toBeInTheDocument();
    expect(await screen.findByText("running")).toBeInTheDocument();
    expect(screen.getByText("all good")).toBeInTheDocument();
    expect(screen.getByText("http://127.0.0.1:54318")).toBeInTheDocument();
    expect(screen.getByText("http://127.0.0.1:54320")).toBeInTheDocument();
    expect(screen.getByText("http://127.0.0.1:54320/health")).toBeInTheDocument();
    expect(screen.getByText("/tmp/everr/telemetry-dev")).toBeInTheDocument();
  });

  it("restarts the collector from the settings page", async () => {
    const { restartCollectorSpy } = renderMainApp({
      collectorStatus: failed,
      initialEntry: "/settings",
    });

    expect(await screen.findByText("Local telemetry")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Restart collector" }));

    await waitFor(() => {
      expect(restartCollectorSpy).toHaveBeenCalledTimes(1);
    });
    expect(await screen.findByText("running")).toBeInTheDocument();
  });
});

describe("trace page", () => {
  it("shows the frame while the trace loads", async () => {
    let finishQuery = () => {};
    renderMainApp({
      initialEntry: "/traces/trace-1",
      sqlQuery: () =>
        new Promise((resolve) => {
          finishQuery = () => resolve([]);
        }),
    });

    await waitFor(() => expect(sidebarLink("Logs")).toBeInTheDocument(), { timeout: 3_000 });
    await act(async () => finishQuery());
  });

  it("loads the trace when the collector is ready just after the first load failed", async () => {
    let sqlQueries = 0;
    renderMainApp({
      initialEntry: "/traces/trace-1",
      sqlQuery: () => {
        sqlQueries += 1;
        if (sqlQueries === 1) throw new Error("collector is not running");
        return [];
      },
    });

    await waitFor(() => expect(sqlQueries).toBeGreaterThan(1));
    await waitFor(() => expect(sidebarLink("Logs")).toBeInTheDocument());
    expect(screen.queryByText("Failed to load trace")).toBeNull();
  });
});

describe("trace page while the collector is down", () => {
  it("loads the trace once a restart brings the collector up", async () => {
    const { restartCollectorSpy, localCommandSpy } = renderMainApp({
      collectorStatus: failed,
      initialEntry: "/traces/trace-1",
    });

    expect(await screen.findByText("Local telemetry unavailable")).toBeInTheDocument();
    const queriesBefore = localCommandSpy.mock.calls.filter(
      ([command]) => command === "telemetry_sql_query",
    ).length;

    fireEvent.click(screen.getByRole("button", { name: "Restart collector" }));
    await waitFor(() => expect(restartCollectorSpy).toHaveBeenCalledTimes(1));

    await waitFor(() => {
      const queriesNow = localCommandSpy.mock.calls.filter(
        ([command]) => command === "telemetry_sql_query",
      ).length;
      expect(queriesNow).toBeGreaterThan(queriesBefore);
    });
    expect(screen.queryByText("Failed to load trace")).toBeNull();
    expect(screen.queryByText("Local telemetry unavailable")).toBeNull();
  });

  it("loads the trace once the status poll sees the collector running", async () => {
    const { router, setCollectorStatus } = renderMainApp({
      collectorStatus: { status: "starting", ...endpoints },
      initialEntry: "/traces/trace-1",
    });

    expect(await screen.findByText("Starting local telemetry")).toBeInTheDocument();

    setCollectorStatus(running);
    await act(async () => {
      await router.options.context.queryClient.refetchQueries({
        queryKey: ["local-app", "collector-status"],
      });
    });

    await waitFor(() => expect(screen.queryByText("Starting local telemetry")).toBeNull());
    expect(screen.queryByText("Failed to load trace")).toBeNull();
  });
});
