import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { createQueryClient } from "./lib/query-client";
import { router } from "./router";
import { mockCommands } from "./test-commands";

type AuthStatus = {
  status: "signed_in" | "signed_out";
  session_path: string;
};

type PendingSignIn = {
  status: "pending";
  user_code: string;
  verification_url: string;
  expires_at: string;
  poll_interval_seconds: number;
};

type SignInResponse =
  | PendingSignIn
  | { status: "signed_in"; session_path: string }
  | { status: "denied" | "expired" };

type CollectorStatus = {
  status: "starting" | "running" | "failed" | "stopped";
  reason?: string;
  otlpEndpoint: string;
  sqlEndpoint: string;
  healthEndpoint: string;
  telemetryDir?: string;
};

type RunListItem = {
  traceId: string;
  runId: string;
  runAttempt: number;
  workflowName: string;
  repo: string;
  branch: string;
  conclusion: string;
  duration: number;
  timestamp: string;
  sender: string;
};

type MainCommand =
  | "get_auth_status"
  | "get_pending_sign_in"
  | "start_sign_in"
  | "poll_sign_in"
  | "open_sign_in_browser"
  | "sign_out"
  | "get_notification_emails"
  | "set_notification_emails"
  | "get_collector_status"
  | "telemetry_sql_query"
  | "restart_collector"
  | "get_runs_list"
  | "get_runs_histogram"
  | "get_run_filter_options"
  | "open_run_in_browser"
  | "get_run_auto_fix_prompt"
  | "get_skills_status"
  | "install_skills";

type RenderMainOptions = {
  signedIn?: boolean;
  notificationEmails?: string[];
  pendingSignIn?: PendingSignIn | null;
  runs?: RunListItem[];
  collectorStatus?: CollectorStatus;
  commandOverrides?: Partial<Record<MainCommand, (args: unknown) => unknown>>;
};

function renderWithProviders(
  node: ReactNode,
  queryClient = createQueryClient(),
) {
  render(
    <QueryClientProvider client={queryClient}>{node}</QueryClientProvider>,
  );

  return queryClient;
}

function createRun(overrides: Partial<RunListItem> = {}): RunListItem {
  return {
    traceId: "trace-run-1",
    runId: "run-1",
    runAttempt: 1,
    workflowName: "CI",
    repo: "everr-labs/everr",
    branch: "main",
    conclusion: "failure",
    duration: 120,
    timestamp: "2026-03-07T13:32:00Z",
    sender: "user@example.com",
    ...overrides,
  };
}

function renderMainApp(options: RenderMainOptions = {}) {
  let authStatus: AuthStatus = {
    status: options.signedIn === false ? "signed_out" : "signed_in",
    session_path: "/tmp/everr/session.json",
  };
  let notificationEmails = options.notificationEmails ?? ["user@example.com"];
  let pendingSignIn: PendingSignIn | null = options.pendingSignIn ?? null;
  const openSignInBrowserSpy = vi.fn(() => null);
  let runs = options.runs ?? [];
  const runningCollectorStatus = {
    status: "running",
    otlpEndpoint: "http://127.0.0.1:54318",
    sqlEndpoint: "http://127.0.0.1:54320",
    healthEndpoint: "http://127.0.0.1:54319",
    telemetryDir: "/tmp/everr/telemetry-dev",
  } satisfies CollectorStatus;
  let collectorStatus = options.collectorStatus ?? runningCollectorStatus;
  const restartCollectorSpy = vi.fn(() => {
    collectorStatus = runningCollectorStatus;
    return collectorStatus;
  });

  mockCommands((cmd, args) => {
    const payload = (args ?? {}) as {
      enabled?: boolean;
      emails?: string[];
    };

    const override = options.commandOverrides?.[cmd as MainCommand];
    if (override) {
      return override(payload);
    }

    switch (cmd) {
      case "plugin:window|close":
        return null;
      case "plugin:window|is_fullscreen":
        return false;
      case "get_auth_status":
        return authStatus;
      case "get_pending_sign_in":
        return pendingSignIn;
      case "start_sign_in":
        pendingSignIn = {
          status: "pending",
          user_code: "ABCD-EFGH",
          verification_url: "https://app.everr.dev/cli/device?code=ABCD-EFGH",
          expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
          poll_interval_seconds: 1,
        };
        return pendingSignIn satisfies SignInResponse;
      case "poll_sign_in":
        return (
          pendingSignIn ?? ({ status: "expired" } satisfies SignInResponse)
        );
      case "open_sign_in_browser":
        return openSignInBrowserSpy();
      case "sign_out":
        authStatus = {
          ...authStatus,
          status: "signed_out",
        };
        pendingSignIn = null;
        return authStatus;
      case "get_notification_emails":
        return notificationEmails;
      case "set_notification_emails":
        notificationEmails = payload.emails ?? [];
        return null;
      case "get_collector_status":
        return collectorStatus;
      case "telemetry_sql_query":
        return [];
      case "get_skills_status":
        return [];
      case "install_skills":
        return null;
      case "restart_collector":
        return restartCollectorSpy();
      case "get_runs_list":
        return { runs, totalCount: runs.length };
      case "get_runs_histogram":
        return [];
      case "get_run_filter_options":
        return { repos: [], branches: [], workflowNames: [] };
      case "open_run_in_browser":
        return null;
      case "copy_run_auto_fix_prompt":
        return null;
      default:
        throw new Error(`Unexpected IPC command: ${cmd}`);
    }
  });

  renderWithProviders(<RouterProvider router={router} />);

  return {
    openSignInBrowserSpy,
    restartCollectorSpy,
    setRuns(next: RunListItem[]) {
      runs = next;
    },
  };
}

describe("local app", () => {
  it("renders the CI runs view at /ci when signed in", async () => {
    renderMainApp();

    await act(async () => {
      await router.load();
      await router.navigate({ to: "/ci" });
    });

    expect(await screen.findByText("CI runs")).toBeInTheDocument();
    expect(
      screen.queryByText("Sign in to view your CI runs"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Background tasks")).not.toBeInTheDocument();
  });

  it("shows the inline CI sign-in when not authenticated", async () => {
    renderMainApp({
      signedIn: false,
    });

    await act(async () => {
      await router.navigate({ to: "/ci" });
    });

    expect(
      await screen.findByText("Sign in to view your CI runs"),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign in" })).toBeInTheDocument();
  });

  it("renders local pages without an auth wall when signed out", async () => {
    renderMainApp({
      signedIn: false,
    });

    await act(async () => {
      await router.navigate({ to: "/logs" });
    });

    expect(
      screen.queryByText("Sign in to view your CI runs"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Sign in" }),
    ).not.toBeInTheDocument();
  });
});

describe("runs list", () => {
  it("shows an empty state when there are no runs", async () => {
    renderMainApp({ runs: [] });

    await act(async () => {
      await router.navigate({ to: "/ci" });
    });

    expect(await screen.findByText("No runs")).toBeInTheDocument();
  });

  it("mounts the runs explorer (with the Your-runs filter) when there are runs", async () => {
    // Row rendering is virtualized (react-virtuoso) and covered by the web app
    // tests; here we just assert the local CI page mounts the shared explorer
    // — including the local "Your runs" filter — without erroring.
    renderMainApp({
      runs: [
        createRun({ traceId: "trace-a", workflowName: "Build" }),
        createRun({ traceId: "trace-b", workflowName: "Deploy" }),
      ],
    });

    await act(async () => {
      await router.navigate({ to: "/ci" });
    });

    expect(await screen.findByText("Your runs")).toBeInTheDocument();
    expect(screen.getByText("All repositories")).toBeInTheDocument();
  });

  it("warns to add a author email when none is set", async () => {
    renderMainApp({
      runs: [createRun({ traceId: "trace-a", workflowName: "Build" })],
      notificationEmails: [],
    });

    await act(async () => {
      await router.navigate({ to: "/ci" });
    });

    expect(
      await screen.findByRole("button", { name: /add author email/i }),
    ).toBeInTheDocument();
  });

  it("does not warn when a author email is set", async () => {
    renderMainApp({
      runs: [createRun({ traceId: "trace-a", workflowName: "Build" })],
      notificationEmails: ["me@example.com"],
    });

    await act(async () => {
      await router.navigate({ to: "/ci" });
    });

    expect(await screen.findByText("Your runs")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /add author email/i }),
    ).not.toBeInTheDocument();
  });
});

describe("local telemetry collector", () => {
  it("shows an inline restart action when logs are unavailable", async () => {
    const { restartCollectorSpy } = renderMainApp({
      collectorStatus: {
        status: "failed",
        reason: "collector exited",
        otlpEndpoint: "http://127.0.0.1:54318",
        sqlEndpoint: "http://127.0.0.1:54320",
        healthEndpoint: "http://127.0.0.1:54319",
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
    renderMainApp({
      collectorStatus: {
        status: "running",
        otlpEndpoint: "http://127.0.0.1:54318",
        sqlEndpoint: "http://127.0.0.1:54320",
        healthEndpoint: "http://127.0.0.1:54319",
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
    renderMainApp({
      collectorStatus: {
        status: "starting",
        otlpEndpoint: "http://127.0.0.1:54318",
        sqlEndpoint: "http://127.0.0.1:54320",
        healthEndpoint: "http://127.0.0.1:54319",
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
    const { restartCollectorSpy } = renderMainApp({
      collectorStatus: {
        status: "failed",
        reason: "collector exited",
        otlpEndpoint: "http://127.0.0.1:54318",
        sqlEndpoint: "http://127.0.0.1:54320",
        healthEndpoint: "http://127.0.0.1:54319",
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

describe("author emails", () => {
  it("shows existing emails in the settings page", async () => {
    renderMainApp({
      notificationEmails: ["alice@example.com", "bob@example.com"],
    });

    await act(async () => {
      await router.navigate({ to: "/settings" });
    });

    expect(await screen.findByText("alice@example.com")).toBeInTheDocument();
    expect(screen.getByText("bob@example.com")).toBeInTheDocument();
  });

  it("validates email format before adding", async () => {
    renderMainApp({
      notificationEmails: [],
    });

    await act(async () => {
      await router.navigate({ to: "/settings" });
    });

    const input = await screen.findByPlaceholderText("Add email address");
    fireEvent.change(input, { target: { value: "not-an-email" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    expect(
      await screen.findByText("Please enter a valid email address."),
    ).toBeInTheDocument();
  });

  it("prevents adding a duplicate email", async () => {
    renderMainApp({
      notificationEmails: ["alice@example.com"],
    });

    await act(async () => {
      await router.navigate({ to: "/settings" });
    });

    await screen.findByText("alice@example.com");
    const input = screen.getByPlaceholderText("Add email address");
    fireEvent.change(input, { target: { value: "alice@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    expect(
      await screen.findByText("This email is already added."),
    ).toBeInTheDocument();
  });
});
