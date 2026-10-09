import { QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
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

function renderMainApp(
  options: { collectorStatus?: CollectorStatus; signedIn?: boolean } = {},
) {
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

  let signedIn = options.signedIn ?? false;
  let pendingSignIn: unknown = null;
  const openSignInBrowserSpy = vi.fn(() => null);
  mockCommands((command) => {
    switch (command) {
      case "get_auth_status":
        return {
          status: signedIn ? "signed_in" : "signed_out",
          session_path: "/tmp/everr/session.json",
        };
      case "get_pending_sign_in":
      case "poll_sign_in":
        return pendingSignIn;
      case "start_sign_in":
        pendingSignIn = {
          status: "pending",
          user_code: "ABCD-EFGH",
          verification_url: "https://app.everr.dev/cli/device?code=ABCD-EFGH",
          expires_at: new Date(Date.now() + 600_000).toISOString(),
          poll_interval_seconds: 5,
        };
        return pendingSignIn;
      case "open_sign_in_browser":
        return openSignInBrowserSpy();
      case "sign_out":
        signedIn = false;
        pendingSignIn = null;
        return {
          status: "signed_out",
          session_path: "/tmp/everr/session.json",
        };
      case "get_user_profile":
        return {
          name: "Test User",
          email: "user@example.com",
          organizationName: "Test Organization",
        };
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

  const router = getRouter();
  router.update({
    history: createMemoryHistory({ initialEntries: ["/settings"] }),
  });
  render(
    <QueryClientProvider client={createQueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );

  return { router, restartCollectorSpy, openSignInBrowserSpy };
}

describe("local telemetry explorer", () => {
  it("opens local telemetry without requiring a Cloud account", async () => {
    const { router } = renderMainApp();
    await act(async () => {
      await router.navigate({ to: "/logs" });
    });

    for (const name of ["Logs", "Traces", "Errors", "Settings"]) {
      expect(screen.getByRole("link", { name })).toBeInTheDocument();
    }
    expect(
      screen.queryByRole("link", { name: "Your CI runs" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Account" })).toBeInTheDocument();
    expect(
      screen.queryByText("Authenticate your Everr account"),
    ).not.toBeInTheDocument();
  });

  it("offers sign-in from settings without CI settings", async () => {
    const { router, openSignInBrowserSpy } = renderMainApp();
    await act(async () => {
      await router.navigate({ to: "/settings" });
    });
    const signIn = await screen.findByRole("button", { name: "Sign in" });
    fireEvent.click(signIn);
    const openBrowser = await screen.findByRole("button", {
      name: "Open browser",
    });
    fireEvent.click(openBrowser);
    await waitFor(() => expect(openSignInBrowserSpy).toHaveBeenCalledTimes(1));
    expect(screen.queryByText("CI author emails")).not.toBeInTheDocument();
  });

  it("shows the account identity and removes it after sign-out", async () => {
    renderMainApp({ signedIn: true });
    fireEvent.click(await screen.findByRole("button", { name: "Account" }));

    expect(await screen.findByText("Test User")).toBeVisible();
    expect(screen.getByText("Test Organization")).toBeVisible();

    fireEvent.click(screen.getByRole("menuitem", { name: "Sign out" }));
    await waitFor(() => {
      expect(screen.queryByText("Test User")).not.toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: "Account" }));
    expect(
      await screen.findByRole("menuitem", { name: "Sign in" }),
    ).toBeVisible();
    expect(screen.queryByText("Test Organization")).not.toBeInTheDocument();
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

    expect(
      await screen.findByText("Local telemetry unavailable"),
    ).toBeInTheDocument();
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

    expect(
      await screen.findByText("Starting local telemetry"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("The local collector is starting."),
    ).toBeInTheDocument();
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
