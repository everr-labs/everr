import { QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";
import { createQueryClient } from "./lib/query-client";
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

function renderMainApp(options: { collectorStatus?: CollectorStatus } = {}) {
  const runningCollectorStatus = {
    status: "running",
    otlpEndpoint: "http://127.0.0.1:54318",
    sqlEndpoint: "http://127.0.0.1:54320",
    healthEndpoint: "http://127.0.0.1:54320/health",
    telemetryDir: "/tmp/everr/telemetry-dev",
  } satisfies CollectorStatus;
  let collectorStatus = options.collectorStatus ?? runningCollectorStatus;
  const restartCollectorSpy = vi.fn(() => {
    collectorStatus = runningCollectorStatus;
    return collectorStatus;
  });

  const localCommandSpy = vi.fn((command: string) => {
    switch (command) {
      case "get_collector_status":
        return collectorStatus;
      case "telemetry_sql_query":
        return [];
      case "restart_collector":
        return restartCollectorSpy();
      default:
        throw new Error(`Unexpected local command: ${command}`);
    }
  });
  mockCommands(localCommandSpy);

  const router = getRouter();
  router.update({
    history: createMemoryHistory({ initialEntries: ["/settings"] }),
  });
  render(
    <QueryClientProvider client={createQueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );

  return { router, restartCollectorSpy, localCommandSpy };
}

describe("local telemetry explorer", () => {
  it("navigates local telemetry using only collector commands", async () => {
    const { router, localCommandSpy } = renderMainApp();
    await act(async () => {
      await router.navigate({ to: "/logs" });
    });

    for (const name of ["Logs", "Traces", "Errors", "Settings"]) {
      expect(screen.getByRole("link", { name })).toBeInTheDocument();
    }
    const localCommands = new Set(["get_collector_status", "telemetry_sql_query"]);
    await waitFor(() => expect(localCommandSpy).toHaveBeenCalled());
    expect(localCommandSpy.mock.calls.every(([command]) => localCommands.has(command))).toBe(true);
  });
});

describe("local telemetry collector", () => {
  it("shows an inline restart action when logs are unavailable", async () => {
    const { router, restartCollectorSpy } = renderMainApp({
      collectorStatus: {
        status: "failed",
        reason: "collector exited",
        otlpEndpoint: "http://127.0.0.1:54318",
        sqlEndpoint: "http://127.0.0.1:54320",
        healthEndpoint: "http://127.0.0.1:54320/health",
        telemetryDir: "/tmp/everr/telemetry-dev",
      },
    });

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

  it("shows local telemetry diagnostics in settings", async () => {
    const { router } = renderMainApp({
      collectorStatus: {
        status: "running",
        otlpEndpoint: "http://127.0.0.1:54318",
        sqlEndpoint: "http://127.0.0.1:54320",
        healthEndpoint: "http://127.0.0.1:54320/health",
        telemetryDir: "/tmp/everr/telemetry-dev",
      },
    });

    await act(async () => {
      await router.navigate({ to: "/settings" });
    });

    expect(await screen.findByText("Local telemetry")).toBeInTheDocument();
    expect(await screen.findByText("running")).toBeInTheDocument();
    expect(screen.getByText("http://127.0.0.1:54318")).toBeInTheDocument();
    expect(screen.getByText("http://127.0.0.1:54320")).toBeInTheDocument();
  });

  it("shows a starting gate while the collector is starting", async () => {
    const { router } = renderMainApp({
      collectorStatus: {
        status: "starting",
        otlpEndpoint: "http://127.0.0.1:54318",
        sqlEndpoint: "http://127.0.0.1:54320",
        healthEndpoint: "http://127.0.0.1:54320/health",
        telemetryDir: "/tmp/everr/telemetry-dev",
      },
    });

    await act(async () => {
      await router.navigate({ to: "/logs" });
    });

    expect(await screen.findByText("Starting local telemetry")).toBeInTheDocument();
    expect(screen.getByText("The local collector is starting.")).toBeInTheDocument();
  });

  it("restarts the collector from the settings page", async () => {
    const { router, restartCollectorSpy } = renderMainApp({
      collectorStatus: {
        status: "failed",
        reason: "collector exited",
        otlpEndpoint: "http://127.0.0.1:54318",
        sqlEndpoint: "http://127.0.0.1:54320",
        healthEndpoint: "http://127.0.0.1:54320/health",
        telemetryDir: "/tmp/everr/telemetry-dev",
      },
    });

    await act(async () => {
      await router.navigate({ to: "/settings" });
    });

    expect(await screen.findByText("Local telemetry")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Restart collector" }));

    await waitFor(() => {
      expect(restartCollectorSpy).toHaveBeenCalledTimes(1);
    });
  });
});
