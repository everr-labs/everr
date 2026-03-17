import { QueryClientProvider } from "@tanstack/react-query";
import { emit } from "@tauri-apps/api/event";
import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import App from "./App";
import {
  NotificationCard,
  activeNotificationQueryKey,
} from "./features/notifications/notification-window";
import { createQueryClient } from "./lib/query-client";

const SETTINGS_CHANGED_EVENT = "everr://settings-changed";
const NOTIFICATION_CHANGED_EVENT = "everr://notification-changed";
const NOTIFICATION_AUTO_DISMISS_MS = 40_000;

type AssistantKind = "codex" | "claude" | "cursor";

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

type CliInstallStatus = {
  status: "installed" | "not_installed";
  install_path: string;
};

type AssistantStatus = {
  assistant: AssistantKind;
  detected: boolean;
  configured: boolean;
  path: string;
};

type AssistantSetup = {
  assistant_statuses: AssistantStatus[];
  assistant_step_seen: boolean;
};

type LaunchAtLoginStatus = {
  launch_at_login_enabled: boolean;
  launch_at_login_step_seen: boolean;
};

type WizardStatus = {
  wizard_completed: boolean;
};

type FailureNotification = {
  dedupeKey: string;
  traceId: string;
  repo: string;
  branch: string;
  workflowName: string;
  failedAt: string;
  detailsUrl: string;
  jobName?: string;
  stepNumber?: string;
  stepName?: string;
  autoFixPrompt?: string;
};

type TestNotificationResponse = {
  status: "shown" | "queued";
};

type MainCommand =
  | "get_wizard_status"
  | "get_auth_status"
  | "get_pending_sign_in"
  | "start_sign_in"
  | "poll_sign_in"
  | "open_sign_in_browser"
  | "sign_out"
  | "get_assistant_setup"
  | "configure_assistants"
  | "mark_assistant_step_seen"
  | "get_cli_install_status"
  | "install_cli"
  | "get_launch_at_login_status"
  | "set_launch_at_login"
  | "mark_launch_at_login_step_seen"
  | "complete_setup_wizard"
  | "reset_dev_onboarding"
  | "trigger_test_notification";

type RenderMainOptions = {
  signedIn?: boolean;
  cliInstalled?: boolean;
  wizardCompleted?: boolean;
  assistantStepSeen?: boolean;
  launchStepSeen?: boolean;
  configuredAssistants?: AssistantKind[];
  launchAtLoginEnabled?: boolean;
  assistantStatuses?: AssistantStatus[];
  testNotification?: TestNotificationResponse;
  pendingSignIn?: PendingSignIn | null;
  commandOverrides?: Partial<Record<MainCommand, (args: unknown) => unknown>>;
};

type NotificationResult = FailureNotification | null | Error;

function renderWithProviders(node: ReactNode, queryClient = createQueryClient()) {
  render(<QueryClientProvider client={queryClient}>{node}</QueryClientProvider>);

  return queryClient;
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;

  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });

  return { promise, resolve, reject };
}

function createNotification(overrides: Partial<FailureNotification> = {}): FailureNotification {
  return {
    dedupeKey: "one",
    traceId: "trace-one",
    repo: "everr-labs/everr",
    branch: "feature/granola",
    workflowName: "CI",
    failedAt: "2026-03-07T13:32:00Z",
    detailsUrl: "https://example.com/runs/trace-one/jobs/job-one/steps/3",
    jobName: "test",
    stepNumber: "3",
    stepName: "Run suite",
    autoFixPrompt: "Investigate and fix trace-one.",
    ...overrides,
  };
}

function defaultAssistantStatuses(configuredAssistants: AssistantKind[] = []): AssistantStatus[] {
  return [
    {
      assistant: "codex",
      detected: true,
      configured: configuredAssistants.includes("codex"),
      path: "/tmp/.codex/AGENTS.md",
    },
    {
      assistant: "claude",
      detected: false,
      configured: configuredAssistants.includes("claude"),
      path: "/tmp/.claude/CLAUDE.md",
    },
    {
      assistant: "cursor",
      detected: true,
      configured: configuredAssistants.includes("cursor"),
      path: "/tmp/.cursor/rules/everr.mdc",
    },
  ];
}

function createAssistantSetup({
  configuredAssistants = [],
  assistantStepSeen = true,
  assistantStatuses = defaultAssistantStatuses(configuredAssistants),
}: {
  configuredAssistants?: AssistantKind[];
  assistantStepSeen?: boolean;
  assistantStatuses?: AssistantStatus[];
} = {}): AssistantSetup {
  return {
    assistant_statuses: assistantStatuses,
    assistant_step_seen: assistantStepSeen,
  };
}

function renderMainApp(options: RenderMainOptions = {}) {
  let authStatus: AuthStatus = {
    status: options.signedIn === false ? "signed_out" : "signed_in",
    session_path: "/tmp/everr/session.json",
  };
  let cliStatus: CliInstallStatus = {
    status: options.cliInstalled === false ? "not_installed" : "installed",
    install_path: "/tmp/everr/bin/everr",
  };
  let assistantSetup = createAssistantSetup({
    configuredAssistants: options.configuredAssistants ?? [],
    assistantStepSeen: options.assistantStepSeen ?? true,
    assistantStatuses:
      options.assistantStatuses ?? defaultAssistantStatuses(options.configuredAssistants ?? []),
  });
  let launchAtLoginStatus: LaunchAtLoginStatus = {
    launch_at_login_enabled: options.launchAtLoginEnabled ?? false,
    launch_at_login_step_seen: options.launchStepSeen ?? true,
  };
  let wizardStatus: WizardStatus = {
    wizard_completed: options.wizardCompleted ?? true,
  };
  let pendingSignIn: PendingSignIn | null = options.pendingSignIn ?? null;
  const openSignInBrowserSpy = vi.fn(() => null);
  const resetDevOnboardingSpy = vi.fn(() => {
    authStatus = {
      ...authStatus,
      status: "signed_out",
    };
    wizardStatus = {
      wizard_completed: false,
    };
    return {
      auth_status: authStatus,
      wizard_status: wizardStatus,
    };
  });
  const triggerTestNotificationSpy = vi.fn(
    () => options.testNotification ?? { status: "shown" },
  );

  mockWindows("main");
  mockIPC(
    (cmd, args) => {
      const payload = (args ?? {}) as {
        assistants?: AssistantKind[];
        enabled?: boolean;
      };

      const override = options.commandOverrides?.[cmd as MainCommand];
      if (override) {
        return override(payload);
      }

      switch (cmd) {
        case "get_wizard_status":
          return wizardStatus;
        case "get_auth_status":
          return authStatus;
        case "get_pending_sign_in":
          return pendingSignIn;
        case "start_sign_in":
          pendingSignIn = {
            status: "pending",
            user_code: "ABCD-EFGH",
            verification_url: "https://app.everr.dev/cli/device?code=ABCD-EFGH",
            expires_at: "2026-03-20T13:10:00Z",
            poll_interval_seconds: 1,
          };
          return pendingSignIn satisfies SignInResponse;
        case "poll_sign_in":
          return pendingSignIn ?? ({ status: "expired" } satisfies SignInResponse);
        case "open_sign_in_browser":
          return openSignInBrowserSpy();
        case "sign_out":
          authStatus = {
            ...authStatus,
            status: "signed_out",
          };
          pendingSignIn = null;
          return authStatus;
        case "get_assistant_setup":
          return assistantSetup;
        case "configure_assistants": {
          const selected = payload.assistants ?? [];
          assistantSetup = {
            ...assistantSetup,
            assistant_step_seen: true,
            assistant_statuses: assistantSetup.assistant_statuses.map((status) => ({
              ...status,
              configured: selected.includes(status.assistant),
            })),
          };
          return assistantSetup;
        }
        case "mark_assistant_step_seen":
          assistantSetup = {
            ...assistantSetup,
            assistant_step_seen: true,
          };
          return assistantSetup;
        case "get_cli_install_status":
          return cliStatus;
        case "install_cli":
          cliStatus = {
            ...cliStatus,
            status: "installed",
          };
          return cliStatus;
        case "get_launch_at_login_status":
          return launchAtLoginStatus;
        case "set_launch_at_login":
          launchAtLoginStatus = {
            ...launchAtLoginStatus,
            launch_at_login_enabled: Boolean(payload.enabled),
            launch_at_login_step_seen: true,
          };
          return launchAtLoginStatus;
        case "mark_launch_at_login_step_seen":
          launchAtLoginStatus = {
            ...launchAtLoginStatus,
            launch_at_login_step_seen: true,
          };
          return launchAtLoginStatus;
        case "complete_setup_wizard":
          wizardStatus = { wizard_completed: true };
          assistantSetup = { ...assistantSetup, assistant_step_seen: true };
          launchAtLoginStatus = {
            ...launchAtLoginStatus,
            launch_at_login_step_seen: true,
          };
          return wizardStatus;
        case "reset_dev_onboarding":
          return resetDevOnboardingSpy();
        case "trigger_test_notification":
          return triggerTestNotificationSpy();
        default:
          throw new Error(`Unexpected IPC command: ${cmd}`);
      }
    },
    { shouldMockEvents: true },
  );

  renderWithProviders(<App />);

  return {
    openSignInBrowserSpy,
    resetDevOnboardingSpy,
    triggerTestNotificationSpy,
    setAssistantSetup(next: AssistantSetup) {
      assistantSetup = next;
    },
    setLaunchAtLoginStatus(next: LaunchAtLoginStatus) {
      launchAtLoginStatus = next;
    },
    setWizardStatus(next: WizardStatus) {
      wizardStatus = next;
    },
  };
}

async function renderNotificationApp(
  initialNotification: NotificationResult = createNotification(),
) {
  let activeNotification: NotificationResult = initialNotification;
  const dismissSpy = vi.fn(() => {
    activeNotification = null;
    return null;
  });
  const openSpy = vi.fn(() => {
    activeNotification = null;
    return null;
  });
  const copySpy = vi.fn(() => null);

  mockWindows("notification");
  mockIPC(
    (cmd) => {
      switch (cmd) {
        case "get_active_notification":
          if (activeNotification instanceof Error) {
            throw activeNotification;
          }
          return activeNotification;
        case "dismiss_active_notification":
          return dismissSpy();
        case "open_notification_target":
          return openSpy();
        case "copy_notification_auto_fix_prompt":
          return copySpy();
        default:
          throw new Error(`Unexpected IPC command: ${cmd}`);
      }
    },
    { shouldMockEvents: true },
  );

  const queryClient = createQueryClient();
  if (!(activeNotification instanceof Error)) {
    queryClient.setQueryData(activeNotificationQueryKey, activeNotification);
  }

  await act(async () => {
    renderWithProviders(<App />, queryClient);
    await Promise.resolve();
    await Promise.resolve();
    if (vi.isFakeTimers()) {
      await vi.advanceTimersByTimeAsync(50);
      await Promise.resolve();
      await Promise.resolve();
    }
  });

  return {
    dismissSpy,
    openSpy,
    copySpy,
    setNotification(nextNotification: FailureNotification | null) {
      activeNotification = nextNotification;
    },
    setNotificationError(error: Error) {
      activeNotification = error;
    },
  };
}

async function renderNotificationCard(
  notification: FailureNotification = createNotification(),
) {
  const dismissSpy = vi.fn(() => null);
  const openSpy = vi.fn(() => null);
  const copySpy = vi.fn(() => null);

  mockIPC(
    (cmd) => {
      switch (cmd) {
        case "dismiss_active_notification":
          return dismissSpy();
        case "open_notification_target":
          return openSpy();
        case "copy_notification_auto_fix_prompt":
          return copySpy();
        default:
          throw new Error(`Unexpected IPC command: ${cmd}`);
      }
    },
    { shouldMockEvents: true },
  );

  await act(async () => {
    renderWithProviders(<NotificationCard notification={notification} />);
    await Promise.resolve();
    await Promise.resolve();
    if (vi.isFakeTimers()) {
      await vi.advanceTimersByTimeAsync(50);
      await Promise.resolve();
      await Promise.resolve();
    }
  });

  return {
    dismissSpy,
    openSpy,
    copySpy,
  };
}

async function flushNotificationRender() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("desktop window", () => {
  it("renders the settings view for completed users", async () => {
    renderMainApp();

    expect(await screen.findByRole("heading", { name: "Settings" })).toBeInTheDocument();
    expect(screen.queryByText("Authenticate your Everr account")).not.toBeInTheDocument();
    expect(screen.getByText("Background tasks")).toBeInTheDocument();
  });

  it("loads settings sections independently", async () => {
    const assistantSetupDeferred = createDeferred<AssistantSetup>();

    renderMainApp({
      commandOverrides: {
        get_assistant_setup: () => assistantSetupDeferred.promise,
      },
    });

    expect(await screen.findByRole("heading", { name: "Settings" })).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Logout" })).toBeInTheDocument();
    expect(screen.getByText("Loading assistant integrations...")).toBeInTheDocument();
    expect(screen.getByText("Background tasks")).toBeInTheDocument();

    assistantSetupDeferred.resolve(createAssistantSetup());
    await screen.findByRole("button", { name: "Save integrations" });
  });

  it("keeps unrelated sections enabled while a mutation is pending", async () => {
    const installCliDeferred = createDeferred<CliInstallStatus>();

    renderMainApp({
      cliInstalled: false,
      commandOverrides: {
        install_cli: () => installCliDeferred.promise,
      },
    });

    fireEvent.click(await screen.findByRole("button", { name: "Install CLI" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Install CLI" })).toBeDisabled();
    });
    expect(screen.getByRole("button", { name: "Enable" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Save integrations" })).toBeEnabled();

    await act(async () => {
      installCliDeferred.resolve({
        status: "installed",
        install_path: "/tmp/everr/bin/everr",
      });
      await Promise.resolve();
      await Promise.resolve();
    });
  });

  it("renders the first-run wizard for incomplete setup", async () => {
    renderMainApp({
      signedIn: false,
      cliInstalled: false,
      wizardCompleted: false,
      assistantStepSeen: false,
      launchStepSeen: false,
    });

    expect(
      await screen.findByRole("heading", { name: "Installation wizard" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Authenticate your Everr account")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign in" })).toBeInTheDocument();
  });

  it("does not preselect assistants on the assistant step", async () => {
    renderMainApp({
      signedIn: true,
      cliInstalled: false,
      wizardCompleted: false,
      assistantStepSeen: false,
      launchStepSeen: false,
      assistantStatuses: defaultAssistantStatuses(),
    });

    expect(await screen.findByText("Select assistants to integrate")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: /codex/i })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: /cursor/i })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: /claude/i })).not.toBeChecked();
  });

  it("does not advance when toggling an assistant in the wizard", async () => {
    renderMainApp({
      signedIn: true,
      cliInstalled: false,
      wizardCompleted: false,
      assistantStepSeen: false,
      launchStepSeen: false,
      assistantStatuses: defaultAssistantStatuses(),
    });

    await screen.findByText("Select assistants to integrate");
    fireEvent.click(screen.getByRole("checkbox", { name: /claude/i }));

    expect(screen.getByText("Select assistants to integrate")).toBeInTheDocument();
    expect(screen.queryByText("Enable background startup")).not.toBeInTheDocument();
  });

  it("advances from authentication to assistant selection after sign in", async () => {
    renderMainApp({
      signedIn: false,
      cliInstalled: false,
      wizardCompleted: false,
      assistantStepSeen: false,
      launchStepSeen: false,
      commandOverrides: {
        poll_sign_in: () => ({
          status: "signed_in",
          session_path: "/tmp/everr/session.json",
        }),
      },
    });

    fireEvent.click(await screen.findByRole("button", { name: "Sign in" }));

    expect(await screen.findByText("Select assistants to integrate")).toBeInTheDocument();
  });

  it("shows the device code before opening the browser", async () => {
    const harness = renderMainApp({
      signedIn: false,
      cliInstalled: false,
      wizardCompleted: false,
      assistantStepSeen: false,
      launchStepSeen: false,
    });

    fireEvent.click(await screen.findByRole("button", { name: "Sign in" }));

    expect(await screen.findByText("A B C D - E F G H")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open browser" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Refresh code" })).not.toBeInTheDocument();
    expect(harness.openSignInBrowserSpy).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Open browser" }));

    await waitFor(() => {
      expect(harness.openSignInBrowserSpy).toHaveBeenCalledTimes(1);
    });
  });

  it("marks the code as expired and disables browser open until refresh", async () => {
    renderMainApp({
      signedIn: false,
      cliInstalled: false,
      wizardCompleted: false,
      assistantStepSeen: false,
      launchStepSeen: false,
      pendingSignIn: {
        status: "pending",
        user_code: "WXYZ-1234",
        verification_url: "https://app.everr.dev/cli/device?code=WXYZ-1234",
        expires_at: new Date(Date.now() + 200).toISOString(),
        poll_interval_seconds: 5,
      },
    });

    expect(await screen.findByText("W X Y Z - 1 2 3 4")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open browser" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Refresh code" })).not.toBeInTheDocument();

    await waitFor(() => {
      expect(
        screen.getByText("This code expired before it was approved. Refresh it to generate a new one."),
      ).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Open browser" })).toBeDisabled();
      expect(screen.getAllByRole("button", { name: "Refresh code" }).length).toBeGreaterThan(0);
    });
  });

  it("saves assistant choices and advances to launch at login", async () => {
    renderMainApp({
      signedIn: true,
      cliInstalled: false,
      wizardCompleted: false,
      assistantStepSeen: false,
      launchStepSeen: false,
    });

    await screen.findByText("Select assistants to integrate");
    fireEvent.click(screen.getByRole("checkbox", { name: /claude/i }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    expect(await screen.findByText("Enable background startup")).toBeInTheDocument();
  });

  it("preserves assistant draft across invalidation and resets after save", async () => {
    const harness = renderMainApp({
      configuredAssistants: ["codex"],
      assistantStepSeen: true,
      assistantStatuses: defaultAssistantStatuses(["codex"]),
    });

    const claudeCheckbox = await screen.findByRole("checkbox", { name: /claude/i });

    fireEvent.click(claudeCheckbox);
    expect(claudeCheckbox).toBeChecked();

    await act(async () => {
      await emit(SETTINGS_CHANGED_EVENT);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByRole("checkbox", { name: /claude/i })).toBeChecked();

    fireEvent.click(screen.getByRole("button", { name: "Save integrations" }));
    await waitFor(() => {
      expect(screen.getByRole("checkbox", { name: /claude/i })).toBeChecked();
    });

    harness.setAssistantSetup(
      createAssistantSetup({
        configuredAssistants: ["codex"],
        assistantStepSeen: true,
        assistantStatuses: defaultAssistantStatuses(["codex"]),
      }),
    );
    await act(async () => {
      await emit(SETTINGS_CHANGED_EVENT);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByRole("checkbox", { name: /codex/i })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /claude/i })).not.toBeChecked();
  });

  it("supports skipping launch at login and finishing the wizard", async () => {
    renderMainApp({
      signedIn: true,
      cliInstalled: true,
      wizardCompleted: false,
      assistantStepSeen: true,
      launchStepSeen: false,
    });

    await screen.findByText("Enable background startup");
    fireEvent.click(await screen.findByRole("button", { name: "Finish" }));

    expect(await screen.findByRole("heading", { name: "Settings" })).toBeInTheDocument();
    expect(await screen.findByText("Setup complete.")).toBeInTheDocument();
  });

  it("triggers a test notification from the settings view", async () => {
    const { triggerTestNotificationSpy } = renderMainApp({
      testNotification: { status: "queued" },
    });

    fireEvent.click(await screen.findByRole("button", { name: "Test notification" }));

    await waitFor(() => {
      expect(triggerTestNotificationSpy).toHaveBeenCalledTimes(1);
    });
    expect(
      await screen.findByText("Test notification queued behind the active notification."),
    ).toBeInTheDocument();
  });

  it("resets the dev session and reopens onboarding from settings", async () => {
    const { resetDevOnboardingSpy } = renderMainApp();

    fireEvent.click(await screen.findByRole("button", { name: "Reset onboarding" }));

    await waitFor(() => {
      expect(resetDevOnboardingSpy).toHaveBeenCalledTimes(1);
    });
    expect(await screen.findByRole("heading", { name: "Installation wizard" })).toBeInTheDocument();
    expect(screen.getByText("Authenticate your Everr account")).toBeInTheDocument();
  });
});

describe("notification window", () => {
  it("renders the active notification with local absolute and relative time", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-07T13:35:00Z"));

    await renderNotificationCard();

    expect(screen.getByText("CI")).toBeInTheDocument();
    expect(screen.getByText("everr-labs/everr")).toBeInTheDocument();
    expect(screen.getByText("feature/granola")).toBeInTheDocument();
    expect(screen.getByText("test • Step 3: Run suite")).toBeInTheDocument();
    expect(screen.getByText("3m ago")).toBeInTheDocument();
    expect(screen.getByText(/^\d{2}:\d{2}$/)).toBeInTheDocument();
  });

  it("dismisses the active notification", async () => {
    const { dismissSpy } = await renderNotificationApp();

    await screen.findByText("CI");
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));

    await waitFor(() => {
      expect(dismissSpy).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(screen.queryByText("CI")).not.toBeInTheDocument();
    });
  });

  it("opens the run target and advances the queue", async () => {
    const { openSpy } = await renderNotificationApp();

    await screen.findByText("CI");
    fireEvent.click(screen.getByRole("button", { name: "Open" }));

    await waitFor(() => {
      expect(openSpy).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(screen.queryByText("CI")).not.toBeInTheDocument();
    });
  });

  it("copies the auto-fix prompt without dismissing the notification", async () => {
    const { copySpy } = await renderNotificationApp();

    await screen.findByText("CI");
    fireEvent.click(screen.getByRole("button", { name: "Auto-fix prompt" }));

    await waitFor(() => {
      expect(copySpy).toHaveBeenCalledTimes(1);
    });
    expect(screen.getByRole("button", { name: "Copied" })).toBeInTheDocument();
    expect(screen.getByText("CI")).toBeInTheDocument();
  });

  it("does not auto-dismiss before the deadline", async () => {
    vi.useFakeTimers();

    const { dismissSpy } = await renderNotificationCard();
    expect(screen.getByText("CI")).toBeInTheDocument();

    await vi.advanceTimersByTimeAsync(NOTIFICATION_AUTO_DISMISS_MS - 1_000);
    await flushNotificationRender();

    expect(dismissSpy).not.toHaveBeenCalled();
    expect(screen.getByText("CI")).toBeInTheDocument();
  });

  it("auto-dismisses after the deadline", async () => {
    vi.useFakeTimers();

    const { dismissSpy } = await renderNotificationCard();
    expect(screen.getByText("CI")).toBeInTheDocument();

    await vi.advanceTimersByTimeAsync(NOTIFICATION_AUTO_DISMISS_MS);
    await flushNotificationRender();

    expect(dismissSpy).toHaveBeenCalledTimes(1);
  });

  it("pauses the dismiss countdown while hovered", async () => {
    vi.useFakeTimers();

    const { dismissSpy } = await renderNotificationCard();
    const card = screen.getByText("CI");

    fireEvent.mouseEnter(card.closest(".notificationCard") as HTMLElement);
    await vi.advanceTimersByTimeAsync(NOTIFICATION_AUTO_DISMISS_MS);
    expect(dismissSpy).not.toHaveBeenCalled();

    fireEvent.mouseLeave(card.closest(".notificationCard") as HTMLElement);
    await vi.advanceTimersByTimeAsync(NOTIFICATION_AUTO_DISMISS_MS);
    await flushNotificationRender();

    expect(dismissSpy).toHaveBeenCalledTimes(1);
  });

  it("refreshes when the backend emits a notification-changed event", async () => {
    const harness = await renderNotificationApp();
    await screen.findByText("CI");

    harness.setNotification(
      createNotification({
        dedupeKey: "two",
        traceId: "trace-two",
        workflowName: "Nightly",
      }),
    );
    await act(async () => {
      await emit(NOTIFICATION_CHANGED_EVENT);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(await screen.findByText("Nightly")).toBeInTheDocument();
  });

  it("shows a retry state when fetching the active notification fails", async () => {
    const harness = await renderNotificationApp(new Error("boom"));

    expect(await screen.findByText("Failed to load notification")).toBeInTheDocument();

    harness.setNotification(createNotification());
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Retry" }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(await screen.findByText("CI")).toBeInTheDocument();
  });
});
